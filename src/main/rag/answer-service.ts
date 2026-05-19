/**
 * Plan 07-03 Task 4 — Answer service.
 *
 * Ties together: retrieval (Task 1) + person resolver (Task 2) + answer router
 * (Task 3) + thread persistence (this task). Single entry point: `ask()`.
 *
 * Flow:
 *   1. Validate question length (ASVS V5 — 4 KB cap).
 *   2. Resolve person mentions. Ambiguous → return disambiguation.
 *   3. Hybrid retrieve top-10 chunks. Empty → persist refusal turn → refusal.
 *   4. Load thread history (lastN=6) when threadId is set (C6).
 *   5. Route LOCAL vs FRONTIER from cached sensitivity (C5).
 *   6. Build prompt; call generateObject with Zod schema (no tools).
 *   7. Validate citations; all-dropped → refusal.
 *   8. Persist user + assistant turns; return RagAnswerResult.
 *   9. Ollama-down / timeout / 5xx → RagErrorResult; persist NO turn.
 *
 * Logging hygiene: never log raw question/answer/chunk text. Routing-log entry
 * via writeRoutingLog with prompt_hash only.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import {
  routeAnswer,
  buildFrontierPrompt,
  buildLocalPrompt,
  validateAnswer,
  type RouterChunk,
  type Route,
  type ThreadTurnSummary,
} from './answer-router';
import {
  hybridRetrieve,
  type EmbedClient,
  type RetrievedChunk,
} from './hybrid-retrieval';
import type { VectorStore } from './vector-store';
import {
  resolvePersonMentions,
  type LocalLlmDisambiguator,
} from './person-resolver';
import {
  createThread,
  appendTurn,
  getThread,
  type ThreadRow,
} from './threads';
import { redactAllPii } from '../briefing/redact';
import {
  disposeRedactionRoundtrip,
  tokenizeForFrontier,
  rehydrate,
} from '../llm/redaction-roundtrip';
import { writeRoutingLog, hashPrompt } from '../llm/routingLog';
import type { Db } from '../db/connect';

type DbAny = Database.Database;

const REFUSAL_TEXT = "I couldn't find anything in your data about that.";
const ERROR_TEXT =
  'Aria couldn\'t reach the local model — please check Ollama is running';

export interface RagCitation {
  index: number;
  sourceKind: 'email' | 'event' | 'note' | 'action';
  sourceId: string;
  title: string;
  snippet: string;
  charStart: number;
  charEnd: number;
  occurredAt?: string;
  accountChip?: {
    provider: 'google' | 'microsoft';
    email: string;
    disconnected?: boolean;
  };
}

export interface RagRoutingInfo {
  route: Route;
  modelId: string;
  sensitivity: string;
  reason: string;
  directoryStale?: boolean;
}

export interface RagAnswerResult {
  kind: 'answer';
  text: string;
  citations: RagCitation[];
  routing: RagRoutingInfo;
  threadId: string;
  turnId: string;
}

export interface RagRefusalResult {
  kind: 'refusal';
  text: typeof REFUSAL_TEXT;
  threadId: string;
  turnId: string;
}

export interface RagErrorResult {
  kind: 'error';
  text: string;
  detail?: string;
}

export interface RagDisambiguationResult {
  kind: 'disambiguation';
  candidates: Array<{
    personId: string;
    displayName: string;
    canonicalEmail: string | null;
    recentContext: string;
  }>;
  threadId: string;
}

export type RagAskResponse =
  | RagAnswerResult
  | RagRefusalResult
  | RagErrorResult
  | RagDisambiguationResult;

export interface RagAskRequest {
  question: string;
  threadId?: string;
  accountFilter?: Array<{ providerKey: string; accountId: string }>;
  forcePersonId?: string;
  /** Plan 07-03 Task 6 — Cmd-K marks transient threads to hide them from /ask. */
  transient?: boolean;
}

export interface AccountStatusLookup {
  (providerKey: string, accountId: string):
    | { provider: 'google' | 'microsoft'; email: string; disconnected: boolean }
    | null;
}

export interface LlmInvocation {
  /** Returns parsed { answer, citations } shape OR throws on transport error. */
  generate(args: {
    prompt: string;
    route: Route;
    requestKey: string;
  }): Promise<{ answer: string; citations: number[] } | null>;
}

export interface AnswerServiceDeps {
  db: DbAny;
  logger: Logger;
  embedClient: EmbedClient;
  vectorStore: VectorStore;
  localLlm?: LocalLlmDisambiguator;
  llm: LlmInvocation;
  accountStatus?: AccountStatusLookup;
  /** Returns the currently active embedding model id for telemetry. */
  getActiveEmbedModelId?: () => string;
  /** Override request-key generator (tests). */
  newRequestKey?: () => string;
}

function newRequestKey(): string {
  // ULID-ish: monotonic timestamp + 16 hex chars random. Disjoint from
  // approvalId shape used by Phase 3 (which is UUID).
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 1e16).toString(36);
  return `req_${ts}_${rnd}`;
}

function asRouterChunk(c: RetrievedChunk): RouterChunk {
  return {
    id: c.id,
    text: c.text,
    sourceKind: c.sourceKind,
    sourceId: c.sourceId,
    title: c.title,
    sensitivity: c.sensitivity,
  };
}

function snippetOf(text: string): string {
  if (text.length <= 200) return text;
  return text.slice(0, 197) + '…';
}

function buildCitations(
  validIndices: number[],
  chunks: RetrievedChunk[],
  accountStatus?: AccountStatusLookup,
): RagCitation[] {
  return validIndices.map((n) => {
    const c = chunks[n - 1]!;
    let accountChip: RagCitation['accountChip'] | undefined;
    if (c.providerKey && c.accountId && accountStatus) {
      const a = accountStatus(c.providerKey, c.accountId);
      if (a) accountChip = a;
    }
    return {
      index: n,
      sourceKind: c.sourceKind,
      sourceId: c.sourceId,
      title: c.title,
      snippet: snippetOf(c.text),
      charStart: c.charStart,
      charEnd: c.charEnd,
      occurredAt: c.occurredAt ?? undefined,
      accountChip,
    };
  });
}

export interface AnswerService {
  ask(req: RagAskRequest): Promise<RagAskResponse>;
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const {
    db,
    logger,
    embedClient,
    vectorStore,
    localLlm,
    llm,
    accountStatus,
    getActiveEmbedModelId,
    newRequestKey: keyGen = newRequestKey,
  } = deps;

  async function ask(req: RagAskRequest): Promise<RagAskResponse> {
    const started = Date.now();
    const requestKey = keyGen();

    if (!req.question || req.question.length === 0) {
      return { kind: 'error', text: ERROR_TEXT, detail: 'empty-question' };
    }
    if (req.question.length > 4096) {
      return { kind: 'error', text: ERROR_TEXT, detail: 'question-too-long' };
    }

    // 1. Ensure thread.
    let threadId = req.threadId;
    let createdThread: ThreadRow | null = null;
    if (!threadId) {
      createdThread = createThread(db, {
        title: req.transient ? '(transient)' : undefined,
      });
      threadId = createdThread.id;
    }

    // 2. Resolve person mentions.
    let resolved: Awaited<ReturnType<typeof resolvePersonMentions>>;
    try {
      resolved = await resolvePersonMentions(
        { db, localLlm },
        req.question,
        {
          threadHistory: req.threadId
            ? (getThread(db, req.threadId, { lastN: 6 })?.turns ?? []).map(
                (t) => ({ role: t.role, text: t.text }),
              )
            : [],
        },
      );
    } catch (err) {
      logger.warn(
        { scope: 'rag.answer-service', err: (err as Error).message },
        'rag.answer-service.resolve-fail',
      );
      return { kind: 'error', text: ERROR_TEXT, detail: 'resolve-failed' };
    }

    let rewrittenQuestion = req.question;
    let directoryStale = false;
    if (resolved.kind === 'ambiguous' && !req.forcePersonId) {
      return {
        kind: 'disambiguation',
        candidates: resolved.candidates.map((p) => ({
          personId: p.id,
          displayName: p.displayName,
          canonicalEmail: p.canonicalEmail,
          recentContext: '',
        })),
        threadId,
      };
    } else if (resolved.kind === 'resolved') {
      rewrittenQuestion = resolved.rewritten;
      directoryStale = resolved.directoryStale;
    } else {
      // ambiguous but forcePersonId provided
      directoryStale = resolved.directoryStale;
    }

    // 3. Hybrid retrieve.
    let retrieved: RetrievedChunk[] = [];
    try {
      retrieved = await hybridRetrieve(
        { db, embedClient, vectorStore },
        rewrittenQuestion,
        { accountFilter: req.accountFilter, topK: 10 },
      );
    } catch (err) {
      logger.warn(
        { scope: 'rag.answer-service', err: (err as Error).message },
        'rag.answer-service.retrieve-fail',
      );
      return { kind: 'error', text: ERROR_TEXT, detail: 'retrieve-failed' };
    }

    // 4. Empty retrieval → refusal turn + refusal result.
    if (retrieved.length === 0) {
      appendTurn(db, { threadId, role: 'user', text: req.question });
      const refusalTurn = appendTurn(db, {
        threadId,
        role: 'assistant',
        text: REFUSAL_TEXT,
        routing: { route: 'LOCAL', reason: 'rag-answer:no-sources', sensitivity: 'none' },
      });
      return {
        kind: 'refusal',
        text: REFUSAL_TEXT,
        threadId,
        turnId: refusalTurn.id,
      };
    }

    // 5. Thread history for C6.
    let threadHistory: ThreadTurnSummary[] = [];
    if (req.threadId) {
      const t = getThread(db, req.threadId, { lastN: 6 });
      if (t) threadHistory = t.turns.map((tr) => ({ role: tr.role, text: tr.text }));
    }

    // 6. Route.
    const routerChunks = retrieved.map(asRouterChunk);
    const decision = routeAnswer(rewrittenQuestion, routerChunks);

    // 7. Build prompt + call LLM.
    let prompt: string;
    if (decision.route === 'FRONTIER') {
      prompt = buildFrontierPrompt(
        { question: rewrittenQuestion, chunks: routerChunks, threadHistory },
        (s) => {
          const { prompt: redacted } = tokenizeForFrontier(requestKey, s);
          return redacted;
        },
      );
    } else {
      prompt = buildLocalPrompt({
        question: rewrittenQuestion,
        chunks: routerChunks,
        threadHistory,
      });
    }

    let raw: { answer: string; citations: number[] } | null;
    try {
      raw = await llm.generate({ prompt, route: decision.route, requestKey });
    } catch (err) {
      logger.warn(
        { scope: 'rag.answer-service', err: (err as Error).message, route: decision.route },
        'rag.answer-service.llm-fail',
      );
      try {
        disposeRedactionRoundtrip(requestKey);
      } catch {
        /* no-op when no table was registered */
      }
      return { kind: 'error', text: ERROR_TEXT, detail: (err as Error).message };
    }

    try {
      if (raw && decision.route === 'FRONTIER') {
        // Rehydrate any tokens the model parroted back.
        try {
          raw = { ...raw, answer: rehydrate(requestKey, raw.answer) };
        } catch {
          /* no table — nothing to rehydrate */
        }
      }
    } finally {
      try {
        disposeRedactionRoundtrip(requestKey);
      } catch {
        /* no-op */
      }
    }

    const validated = raw ? validateAnswer(raw, routerChunks.length) : null;

    // 8. All-dropped → refusal.
    if (!validated) {
      appendTurn(db, { threadId, role: 'user', text: req.question });
      const refusalTurn = appendTurn(db, {
        threadId,
        role: 'assistant',
        text: REFUSAL_TEXT,
        routing: {
          route: decision.route,
          reason: 'rag-answer:citations-empty',
          sensitivity: decision.sensitivity,
        },
      });
      // Routing log — hash only.
      writeRoutingLog(db as unknown as Db, {
        ts: new Date().toISOString(),
        route: decision.route,
        reason: 'rag-answer:citations-empty',
        source: 'generic',
        prompt_hash: hashPrompt(prompt),
        model: 'rag-answer',
        latency_ms: Date.now() - started,
        ok: 1,
      });
      return {
        kind: 'refusal',
        text: REFUSAL_TEXT,
        threadId,
        turnId: refusalTurn.id,
      };
    }

    // 9. Persist + return answer.
    const routing: RagRoutingInfo = {
      route: decision.route,
      modelId:
        decision.route === 'FRONTIER' ? 'frontier' : 'local',
      sensitivity: decision.sensitivity,
      reason: decision.reason,
      directoryStale: directoryStale || undefined,
    };
    const citations = buildCitations(validated.citations, retrieved, accountStatus);

    appendTurn(db, { threadId, role: 'user', text: req.question });
    const assistantTurn = appendTurn(db, {
      threadId,
      role: 'assistant',
      text: validated.answer,
      citations,
      routing,
      embeddingModelId: getActiveEmbedModelId?.() ?? null,
      retrievalStrategy: 'hybrid',
      totalCostUsd: 0,
    });

    writeRoutingLog(db as unknown as Db, {
      ts: new Date().toISOString(),
      route: decision.route,
      reason: decision.reason,
      source: 'generic',
      prompt_hash: hashPrompt(prompt),
      model: 'rag-answer',
      latency_ms: Date.now() - started,
      ok: 1,
    });

    return {
      kind: 'answer',
      text: validated.answer,
      citations,
      routing,
      threadId,
      turnId: assistantTurn.id,
    };
  }

  return { ask };
}

export { REFUSAL_TEXT, ERROR_TEXT };
