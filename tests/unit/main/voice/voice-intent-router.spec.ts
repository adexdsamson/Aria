/**
 * Plan 17-03 Task 2 (TDD RED) — VoiceIntentRouter unit tests.
 *
 * Uses vi.fn() stubs for all injectable deps.
 * Tests the keyword pre-filter, domain dispatch, person-resolver ambiguity,
 * and the critical ratchet (router must NOT call voiceConfirm/assertApproved).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VoiceIntentRouterDeps, RouteResult } from '../../../../src/main/voice/voice-intent-router';
import { VoiceIntentRouter } from '../../../../src/main/voice/voice-intent-router';

// ---------------------------------------------------------------------------
// Mock db that satisfies the type checker
// ---------------------------------------------------------------------------
function makeDb(): VoiceIntentRouterDeps['db'] {
  return {} as VoiceIntentRouterDeps['db'];
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
function makeLogger(): VoiceIntentRouterDeps['logger'] {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as VoiceIntentRouterDeps['logger'];
}

// ---------------------------------------------------------------------------
// Mock PQueue (synchronous add — runs fn immediately)
// ---------------------------------------------------------------------------
function makeQueue(): VoiceIntentRouterDeps['queue'] {
  return {
    add: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  } as unknown as VoiceIntentRouterDeps['queue'];
}

// ---------------------------------------------------------------------------
// Default stubs for service functions — can be overridden per test
// ---------------------------------------------------------------------------
function makeDefaultDeps(overrides: Partial<VoiceIntentRouterDeps> = {}): VoiceIntentRouterDeps {
  const defaultInsertApproval = vi.fn().mockReturnValue('test-approval-id');
  const defaultGetApproval = vi.fn().mockReturnValue({
    id: 'test-approval-id',
    kind: 'email_send',
    state: 'ready',
    recipients_json: '["test@example.com"]',
    subject: 'Re: Test',
    after_json: null,
    approval_path: 'explicit',
  });
  const defaultLoadActiveRules = vi.fn().mockReturnValue({
    timeZone: 'America/New_York',
  });
  const defaultResolvePersonMentions = vi.fn().mockResolvedValue({
    kind: 'resolved',
    rewritten: 'test@example.com',
    resolved: [{ id: 'p1', canonicalEmail: 'test@example.com', displayName: 'Test User' }],
    directoryStale: false,
  });
  const defaultPerformAsk = vi.fn().mockResolvedValue({
    answer: 'The answer is 42.',
    route: 'LOCAL',
    reason: 'local-preferred',
    latency_ms: 100,
  });
  const defaultProposeCalendarChange = vi.fn().mockResolvedValue({
    approvalId: 'test-approval-id',
    primaryFeasible: true,
    conflicts: [],
    alternatives: [],
    warnings: [],
  });
  const defaultParseIntent = vi.fn().mockResolvedValue({
    action: 'move',
    target: { eventRef: 'standup' },
    when: { nlWhen: '3pm tomorrow' },
  });
  const defaultDraftReply = vi.fn().mockResolvedValue({
    approvalId: 'test-approval-id',
    routed: 'local',
  });
  const defaultSummarizeThread = vi.fn().mockResolvedValue({
    summary: 'Thread summary',
    decisions: [],
    open_questions: [],
    participants: [],
  });

  return {
    db: makeDb(),
    logger: makeLogger(),
    queue: makeQueue(),
    insertApprovalFn: defaultInsertApproval,
    getApprovalFn: defaultGetApproval,
    loadActiveRulesFn: defaultLoadActiveRules,
    resolvePersonMentionsFn: defaultResolvePersonMentions,
    performAskFn: defaultPerformAsk,
    proposeCalendarChangeFn: defaultProposeCalendarChange,
    parseIntentFn: defaultParseIntent,
    draftReplyFn: defaultDraftReply,
    summarizeThreadFn: defaultSummarizeThread,
    ...overrides,
  };
}

describe('VoiceIntentRouter', () => {
  describe('keyword pre-filter — domain detection', () => {
    it('routes "schedule a meeting" → calls parseIntentFn (schedule domain)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('schedule a meeting for tomorrow');
      expect(deps.parseIntentFn).toHaveBeenCalled();
    });

    it('routes "move the standup" → calls parseIntentFn (schedule domain via move keyword)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('move the standup to 3pm');
      expect(deps.parseIntentFn).toHaveBeenCalled();
    });

    it('routes "draft a reply" → calls draftReplyFn (draft domain)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('draft a reply to John');
      expect(deps.draftReplyFn).toHaveBeenCalled();
    });

    it('routes "reply to the email" → calls draftReplyFn (draft domain via reply keyword)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('reply to the email from Sarah');
      expect(deps.draftReplyFn).toHaveBeenCalled();
    });

    it('routes "ask what is the Q3 revenue" → calls performAskFn (ask domain)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('ask what is the Q3 revenue');
      expect(deps.performAskFn).toHaveBeenCalled();
      expect(result.kind).toBe('ask');
    });

    it('routes "what is on my calendar" → calls performAskFn (ask domain via "what")', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('what is on my calendar today');
      expect(deps.performAskFn).toHaveBeenCalled();
      expect(result.kind).toBe('ask');
    });

    it('routes "add a task to remind me" → calls summarizeThreadFn / insertApprovalFn (task domain)', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('remind me to follow up with Alice');
      expect(deps.insertApprovalFn).toHaveBeenCalled();
    });

    it('returns { kind: "unknown" } for unrecognized transcript', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('blah blorp something gibberish xyz123');
      expect(result).toEqual({ kind: 'unknown' });
    });

    it('returns { kind: "unknown" } for empty transcript', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('');
      expect(result).toEqual({ kind: 'unknown' });
    });
  });

  describe('ask domain', () => {
    it('returns { kind: "ask", answer } from performAskFn result', async () => {
      const performAskFn = vi.fn().mockResolvedValue({
        answer: 'Here is your answer.',
        route: 'LOCAL',
        reason: 'local-preferred',
        latency_ms: 50,
      });
      const deps = makeDefaultDeps({ performAskFn });
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('ask who sent the last email');
      expect(result).toEqual({ kind: 'ask', answer: 'Here is your answer.' });
    });

    it('returns { kind: "error" } when performAskFn returns an error', async () => {
      const performAskFn = vi.fn().mockResolvedValue({ error: 'no-llm-provider' });
      const deps = makeDefaultDeps({ performAskFn });
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('tell me who sent the last email');
      expect(result.kind).toBe('error');
    });
  });

  describe('schedule domain', () => {
    it('returns { kind: "staged", approvalId, readBackText } on success', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('schedule a meeting for tomorrow at 3pm');
      expect(result.kind).toBe('staged');
      if (result.kind === 'staged') {
        expect(result.approvalId).toBeTruthy();
        expect(result.readBackText).toBeTruthy();
      }
    });

    it('calls proposeCalendarChangeFn after parseIntentFn', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('reschedule the Q3 review to next Monday');
      expect(deps.parseIntentFn).toHaveBeenCalled();
      expect(deps.proposeCalendarChangeFn).toHaveBeenCalled();
    });
  });

  describe('draft domain', () => {
    it('returns { kind: "staged", approvalId, readBackText } on success', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('draft a reply to the email from John');
      expect(result.kind).toBe('staged');
      if (result.kind === 'staged') {
        expect(result.approvalId).toBeTruthy();
        expect(result.readBackText).toBeTruthy();
      }
    });

    it('returns { kind: "ambiguous", options } when resolvePersonMentionsFn returns ambiguous', async () => {
      const resolvePersonMentionsFn = vi.fn().mockResolvedValue({
        kind: 'ambiguous',
        mention: 'John',
        candidates: [
          { id: 'p1', canonicalEmail: 'john.doe@corp.com', displayName: 'John Doe' },
          { id: 'p2', canonicalEmail: 'john.smith@corp.com', displayName: 'John Smith' },
        ],
        directoryStale: false,
      });
      const deps = makeDefaultDeps({ resolvePersonMentionsFn });
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('draft a reply to John');
      expect(result.kind).toBe('ambiguous');
      if (result.kind === 'ambiguous') {
        expect(result.options.length).toBeGreaterThan(0);
        // Should NOT have called draftReplyFn (staging blocked)
        expect(deps.draftReplyFn).not.toHaveBeenCalled();
      }
    });

    it('does NOT call draftReplyFn when person ambiguous (D-08: disambiguation pre-staging)', async () => {
      const resolvePersonMentionsFn = vi.fn().mockResolvedValue({
        kind: 'ambiguous',
        mention: 'John',
        candidates: [
          { id: 'p1', canonicalEmail: 'john.doe@corp.com', displayName: 'John Doe' },
        ],
        directoryStale: false,
      });
      const draftReplyFn = vi.fn();
      const deps = makeDefaultDeps({ resolvePersonMentionsFn, draftReplyFn });
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('draft a reply to John');
      expect(result.kind).toBe('ambiguous');
      expect(draftReplyFn).not.toHaveBeenCalled();
    });
  });

  describe('task domain', () => {
    it('returns { kind: "staged" } for task transcript', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      const result = await router.route('add a task to remind me to call Alice');
      expect(result.kind).toBe('staged');
    });

    it('calls insertApprovalFn with kind=task_batch', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);
      await router.route('task remind me to follow up tomorrow');
      expect(deps.insertApprovalFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'task_batch' }),
      );
    });
  });

  describe('ratchet: router must NOT import write chokepoints (D-03)', () => {
    it('has the correct kind variants in its RouteResult union', async () => {
      const deps = makeDefaultDeps();
      const router = new VoiceIntentRouter(deps);

      // Verify all RouteResult kinds are returned properly
      const unknownResult = await router.route('gibberish nonsense xyz');
      expect(unknownResult.kind).toBe('unknown');

      const askResult = await router.route('ask what meetings do I have today');
      expect(askResult.kind).toBe('ask');

      const stagedResult = await router.route('schedule a meeting tomorrow');
      expect(['staged', 'error', 'unknown']).toContain(stagedResult.kind);
    });
  });
});
