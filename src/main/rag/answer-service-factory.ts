/**
 * Plan 08-04 Task 2 (B-2 round 2) — AnswerService factory module.
 *
 * Hoisted out of the IPC-handler module-local closure (which was unreachable
 * from Playwright `_electron` test harness — same shape as the Phase-3
 * sensitivity-classifier-was-dark bug, see MEMORY
 * `project_aria_local_llm_pipeline_bug`).
 *
 * The factory:
 *   - exposes a stable, exported `createAnswerServiceFactory()` entry point;
 *   - lazily constructs the AnswerService on the first `.get()` after the
 *     DB becomes available (dbHolder.db !== null);
 *   - emits ONE pino info log entry on first construction
 *     ({ scope: 'answer-service', event: 'factory.constructed' }) — this
 *     is the cross-process ratchet asserted by the Mode-A smoke E2E
 *     (replaces the unreachable closure spy);
 *   - is idempotent — repeated `.get()` calls return the cached instance
 *     and emit NO additional log lines.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import {
  createAnswerService,
  type AnswerService,
  type LlmInvocation,
  type AccountStatusLookup,
} from './answer-service';
import type { VectorStore } from './vector-store';
import type { EmbedClient } from './ollama-embeddings';
import type { LocalLlmDisambiguator } from './person-resolver';

type Db = Database.Database;

export interface DbHolderLike {
  /** Current DB handle (null pre-unlock). */
  readonly db: Db | null;
}

export interface AnswerServiceFactory {
  /** Returns the AnswerService when DB is available; null otherwise. */
  get(): AnswerService | null;
  /** True after the service has been constructed at least once. */
  isConstructed(): boolean;
  /** Total invocations of get() (cached or not). */
  callCount(): number;
}

export interface AnswerServiceFactoryDeps {
  logger: Logger;
  dbHolder: DbHolderLike;
  llm: LlmInvocation;
  /** Vector store constructor — called once per service construction. */
  openVectorStore: (db: Db) => VectorStore;
  /** Embedding client constructor — called once per service construction. */
  makeEmbedClient: () => EmbedClient;
  /** Returns the active embedding model id for routing-log telemetry. */
  readActiveEmbedModelId?: () => string;
  /** Optional local-LLM disambiguator for person resolution. */
  localLlm?: LocalLlmDisambiguator;
  /** Optional account-status lookup for citation chip enrichment. */
  accountStatus?: AccountStatusLookup;
}

/**
 * Create the factory. The factory itself never opens DBs or builds models;
 * it only constructs the AnswerService when the holder reports a non-null
 * DB. Construction emits exactly ONE info-level log line as a cross-process
 * ratchet for the Mode-A smoke spec.
 */
export function createAnswerServiceFactory(
  deps: AnswerServiceFactoryDeps,
): AnswerServiceFactory {
  let cached: AnswerService | null = null;
  let constructed = false;
  let calls = 0;

  return {
    get(): AnswerService | null {
      calls += 1;
      if (cached) return cached;
      const db = deps.dbHolder.db;
      if (!db) return null;
      cached = createAnswerService({
        db,
        logger: deps.logger,
        embedClient: deps.makeEmbedClient(),
        vectorStore: deps.openVectorStore(db),
        llm: deps.llm,
        localLlm: deps.localLlm,
        accountStatus: deps.accountStatus,
        getActiveEmbedModelId: deps.readActiveEmbedModelId,
      });
      constructed = true;
      // Cross-process ratchet — see module header. NEVER move into the
      // cached-hit branch and NEVER duplicate.
      deps.logger.info(
        { scope: 'answer-service', event: 'factory.constructed' },
        'answer-service factory constructed; route active',
      );
      return cached;
    },
    isConstructed(): boolean {
      return constructed;
    },
    callCount(): number {
      return calls;
    },
  };
}
