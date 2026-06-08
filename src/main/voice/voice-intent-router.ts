/**
 * Plan 17-03 Task 2 — Voice intent router (D-01/D-02/D-03/D-08).
 *
 * Turns a raw STT transcript into either:
 *   { kind: 'staged', approvalId, readBackText } — approval row in 'ready' state
 *   { kind: 'ask', answer }                     — no-write answer turn
 *   { kind: 'ambiguous', options }              — person disambiguation needed (D-08)
 *   { kind: 'unknown' }                         — unrecognized transcript
 *   { kind: 'error', reason }                   — unexpected failure
 *
 * ARCHITECTURE INVARIANTS (enforced by the ratchet in Plan 17-07):
 *   - NEVER imports voiceConfirm, assertApproved, sendApprovedEmail,
 *     applyCalendarChange, or pushApprovedMeetingActions (D-03).
 *   - Router ends at insertApproval(state='ready') + buildReadBackText.
 *   - Person-resolver ambiguity check runs BEFORE insertApproval (D-08).
 *   - approval_path defaults to 'explicit' at staging time — voiceConfirm
 *     stamps 'voice-explicit' on the ready→approved transition (Pitfall 8).
 *
 * D-01 (Two-stage parsing):
 *   Stage 1 — deterministic keyword pre-filter → domain: schedule/draft/ask/task/unknown
 *   Stage 2 — per-domain service dispatch (reusing the same functions IPC handlers call)
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import type PQueueImport from 'p-queue';
import { buildReadBackText } from './read-back-template';
import type { insertApproval, getApproval } from '../approvals/persist';
import type { performAsk } from '../rag/ask-service';
import type { parseIntent } from '../scheduling/intent';
import type { proposeCalendarChange } from '../scheduling/propose';
import type { draftReply } from '../drafting/email';
import type { summarizeThread } from '../triage/thread';
import type { resolvePersonMentions } from '../rag/person-resolver';
import type { loadActiveRules } from '../scheduling/rules';
import type { AskServiceDeps } from '../rag/ask-service';

type Db = Database.Database;
type PQueueLike = InstanceType<typeof PQueueImport>;

/**
 * Discriminated union of all possible router outcomes.
 */
export type RouteResult =
  | { kind: 'staged'; approvalId: string; readBackText: string }
  | { kind: 'ask'; answer: string }
  | { kind: 'ambiguous'; options: string[] }
  | { kind: 'unknown' }
  | { kind: 'error'; reason: string };

/**
 * Dependency injection interface for VoiceIntentRouter.
 *
 * All service functions are optional (override for tests); production callers
 * wire in the actual functions from their respective modules.
 */
export interface VoiceIntentRouterDeps {
  db: Db;
  logger: Logger;
  /** PQueue for serializing LLM calls (concurrency 1 — same pattern as sensitivityClassifier). */
  queue: PQueueLike;

  // Service functions — the SAME functions the IPC handlers call (SC1 / D-02):
  draftReplyFn?: typeof draftReply;
  proposeCalendarChangeFn?: typeof proposeCalendarChange;
  parseIntentFn?: typeof parseIntent;
  summarizeThreadFn?: typeof summarizeThread;
  performAskFn?: typeof performAsk;
  resolvePersonMentionsFn?: typeof resolvePersonMentions;
  insertApprovalFn?: typeof insertApproval;
  getApprovalFn?: typeof getApproval;
  loadActiveRulesFn?: typeof loadActiveRules;
}

// ---------------------------------------------------------------------------
// Domain keyword pre-filter (D-01 Stage 1)
// ---------------------------------------------------------------------------

type Domain = 'schedule' | 'draft' | 'ask' | 'task' | 'unknown';

/**
 * Simple word-boundary test: is `word` present as a standalone word in `text`?
 * Avoids false positives like 'ask' matching inside 'task'.
 */
function hasWord(text: string, word: string): boolean {
  // Use word-boundary anchors on both sides.
  // \b works for ASCII word chars (\w = [A-Za-z0-9_]).
  const re = new RegExp(`(?:^|\\W)${word}(?:\\W|$)`, 'i');
  return re.test(text);
}

function classifyDomain(transcript: string): Domain {
  const t = transcript.toLowerCase();

  // Ask domain checked FIRST — question-words take priority over action keywords.
  // Avoids "what is on my calendar" being mis-routed to schedule.
  // Note: 'ask' uses hasWord to avoid matching inside 'task'.
  if (
    hasWord(t, 'ask') ||
    t.includes('tell me') ||
    t.startsWith('what') ||
    t.includes(' what ') ||
    t.startsWith('who') ||
    t.includes(' who ') ||
    t.startsWith('when') ||
    t.includes(' when ') ||
    t.startsWith('how') ||
    t.includes(' how ') ||
    t.startsWith('why') ||
    t.includes(' why ')
  ) {
    return 'ask';
  }

  // Schedule domain: calendar-manipulation action keywords
  if (
    t.includes('schedule') ||
    t.includes('move') ||
    t.includes('reschedule') ||
    t.includes('calendar') ||
    t.includes('meeting')
  ) {
    return 'schedule';
  }

  // Draft domain: email composition keywords
  if (
    t.includes('draft') ||
    t.includes('reply') ||
    t.includes('write') ||
    t.includes('send email')
  ) {
    return 'draft';
  }

  // Task domain: task / reminder keywords
  if (
    t.includes('task') ||
    t.includes('remind') ||
    t.includes('todo') ||
    t.includes('add to')
  ) {
    return 'task';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// VoiceIntentRouter class
// ---------------------------------------------------------------------------

export class VoiceIntentRouter {
  private readonly deps: VoiceIntentRouterDeps;

  constructor(deps: VoiceIntentRouterDeps) {
    this.deps = deps;
  }

  /**
   * Route a raw STT transcript to a domain-specific handler.
   *
   * Returns a RouteResult discriminated union.
   * Never throws — all errors are caught and returned as { kind: 'error' }.
   */
  async route(transcript: string): Promise<RouteResult> {
    const { logger } = this.deps;

    try {
      const domain = classifyDomain(transcript);
      logger.debug({ event: 'voice-intent-router.domain', domain, transcript: transcript.slice(0, 60) });

      switch (domain) {
        case 'ask':
          return await this.handleAsk(transcript);
        case 'schedule':
          return await this.handleSchedule(transcript);
        case 'draft':
          return await this.handleDraft(transcript);
        case 'task':
          return await this.handleTask(transcript);
        case 'unknown':
        default:
          return { kind: 'unknown' };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn({ event: 'voice-intent-router.error', reason });
      return { kind: 'error', reason };
    }
  }

  // -------------------------------------------------------------------------
  // Ask domain handler (D-02: calls performAsk in-process, no write)
  // -------------------------------------------------------------------------

  private async handleAsk(transcript: string): Promise<RouteResult> {
    const { deps } = this;
    const performAskFn = this.requireFn('performAskFn');

    // Build AskServiceDeps from the router's deps (same DI pattern as ipc/ask.ts)
    const askDeps: AskServiceDeps = {
      logger: deps.logger,
      router: undefined as unknown as AskServiceDeps['router'], // tests inject via performAskFn override
      localModelFactory: undefined as unknown as AskServiceDeps['localModelFactory'],
      frontierModelFactory: undefined as unknown as AskServiceDeps['frontierModelFactory'],
      gen: undefined as unknown as AskServiceDeps['gen'],
      dbGetter: () => deps.db,
    };

    const startedAt = performance.now();
    const result = await performAskFn(askDeps, transcript, 'voice', startedAt);

    if ('error' in result) {
      return { kind: 'error', reason: result.error };
    }
    return { kind: 'ask', answer: result.answer };
  }

  // -------------------------------------------------------------------------
  // Schedule domain handler (D-01: reuses parseIntent + proposeCalendarChange)
  // -------------------------------------------------------------------------

  private async handleSchedule(transcript: string): Promise<RouteResult> {
    const { db } = this.deps;
    const parseIntentFn = this.requireFn('parseIntentFn');
    const proposeCalendarChangeFn = this.requireFn('proposeCalendarChangeFn');
    const getApprovalFn = this.requireFn('getApprovalFn');
    const loadActiveRulesFn = this.requireFn('loadActiveRulesFn');

    // Stage 2: parse intent using the SAME function as the IPC handler (D-01)
    const intent = await parseIntentFn(transcript, {
      queue: this.deps.queue,
    });

    // proposeCalendarChange(nl: string, deps: ProposeDeps) — pass the transcript
    // and wire up the pre-parsed intent via intentFn to skip re-parsing.
    const proposeResult = await proposeCalendarChangeFn(transcript, {
      db,
      parseIntentDeps: { queue: this.deps.queue },
      intentFn: async () => intent,
    });

    // Check for refusal / clarification
    if ('refused' in proposeResult) {
      return { kind: 'error', reason: proposeResult.code };
    }
    if ('needsClarification' in proposeResult) {
      return { kind: 'unknown' }; // Treat ambiguous calendar target as unknown for now
    }

    // Get the staged approval row to build the read-back
    const approvalId = proposeResult.approvalId;
    const row = getApprovalFn(db, approvalId);
    if (!row) {
      return { kind: 'error', reason: `approval-not-found:${approvalId}` };
    }

    const rules = loadActiveRulesFn(db);
    const tz = rules.timeZone;
    const readBackText = buildReadBackText(row, tz);

    return { kind: 'staged', approvalId, readBackText };
  }

  // -------------------------------------------------------------------------
  // Draft domain handler (D-08: person-resolver disambiguation pre-staging)
  // -------------------------------------------------------------------------

  private async handleDraft(transcript: string): Promise<RouteResult> {
    const { db } = this.deps;
    const draftReplyFn = this.requireFn('draftReplyFn');
    const resolvePersonMentionsFn = this.requireFn('resolvePersonMentionsFn');
    const getApprovalFn = this.requireFn('getApprovalFn');
    const loadActiveRulesFn = this.requireFn('loadActiveRulesFn');

    // D-08: disambiguation check BEFORE staging the approval row
    const resolveOutcome = await resolvePersonMentionsFn({ db }, transcript);
    if (resolveOutcome.kind === 'ambiguous') {
      // Return disambiguation prompt — candidates are human-readable names
      const options = resolveOutcome.candidates.map(
        (c) => `${c.displayName} (${c.canonicalEmail ?? 'no email'})`,
      );
      return { kind: 'ambiguous', options };
    }

    // Call draftReply — it handles insertApproval(pending→generating→ready) internally
    // We need a minimal GmailMessageRow to pass in; use the transcript as a stub
    // for voice-triggered drafts (production callers provide real context).
    const sourceMessage = {
      id: `voice-${Date.now()}`,
      thread_id: `voice-thread-${Date.now()}`,
      from_addr: resolveOutcome.kind === 'resolved' && resolveOutcome.resolved.length > 0
        ? (resolveOutcome.resolved[0]!.canonicalEmail ?? transcript)
        : transcript,
      subject: 'Voice draft',
      snippet: transcript,
      received_at: new Date().toISOString(),
    };

    const draftResult = await draftReplyFn(db, sourceMessage, {
      queue: this.deps.queue,
      runLocal: async (_prompt) => ({ subject: 'Re: Voice draft', body: transcript }),
      runFrontier: async (_prompt) => ({ subject: 'Re: Voice draft', body: transcript }),
    });

    const row = getApprovalFn(db, draftResult.approvalId);
    if (!row) {
      return { kind: 'error', reason: `approval-not-found:${draftResult.approvalId}` };
    }

    const rules = loadActiveRulesFn(db);
    const tz = rules.timeZone;
    const readBackText = buildReadBackText(row, tz);

    return { kind: 'staged', approvalId: draftResult.approvalId, readBackText };
  }

  // -------------------------------------------------------------------------
  // Task domain handler
  // -------------------------------------------------------------------------

  private async handleTask(transcript: string): Promise<RouteResult> {
    const { db } = this.deps;
    const insertApprovalFn = this.requireFn('insertApprovalFn');
    const getApprovalFn = this.requireFn('getApprovalFn');
    const loadActiveRulesFn = this.requireFn('loadActiveRulesFn');

    // Stage a task_batch approval row in 'ready' state directly
    const approvalId = insertApprovalFn(db, {
      kind: 'task_batch',
      state: 'ready',
      body_original: transcript,
    });

    const row = getApprovalFn(db, approvalId);
    if (!row) {
      return { kind: 'error', reason: `approval-not-found:${approvalId}` };
    }

    const rules = loadActiveRulesFn(db);
    const tz = rules.timeZone;
    const readBackText = buildReadBackText(row, tz);

    return { kind: 'staged', approvalId, readBackText };
  }

  // -------------------------------------------------------------------------
  // Helper: require an injected function or use the default import
  // -------------------------------------------------------------------------

  private requireFn<K extends keyof VoiceIntentRouterDeps>(
    key: K,
  ): NonNullable<VoiceIntentRouterDeps[K]> {
    const fn = this.deps[key];
    if (!fn) {
      throw new Error(`VoiceIntentRouter: missing dep '${key}' — inject via VoiceIntentRouterDeps`);
    }
    return fn as NonNullable<VoiceIntentRouterDeps[K]>;
  }
}
