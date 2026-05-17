---
phase: 03-approval-queue-sensitivity-router-email-triage-drafting-send
plan: 04
type: execute
wave: 4
depends_on: [03-01, 03-02, 03-03]
files_modified:
  - scripts/voice-match-eval.ts
  - src/main/drafting/eval/pairwise.ts
  - .planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-04-SPIKE-VOICE-MATCH.md
  - src/main/db/migrations/009_voice_match_drafting.sql
  - src/main/db/migrations/embedded.ts
  - src/main/drafting/email.ts
  - src/main/drafting/voiceCorpus.ts
  - src/main/ipc/drafting.ts
  - src/main/integrations/google/auth.ts
  - src/main/integrations/google/send.ts
  - src/main/integrations/google/sendLog.ts
  - src/main/ipc/gmail-send.ts
  - src/shared/ipc-contract.ts
  - src/renderer/features/approvals/ApprovalCard.tsx
  - src/renderer/features/settings/IntegrationsSection.tsx
  - tests/unit/integrations/google/send.test.ts
  - tests/integration/drafting-to-approval.test.ts
  - tests/e2e/approve-and-send.spec.ts
  - tests/static/single-send-call-site.test.ts
autonomous: false
user_setup:
  - service: google-gmail-send-scope
    why: "Add gmail.send scope to existing Gmail OAuth consent; CASA-pending banner shown in dev until production verification clears"
    env_vars: []
    dashboard_config:
      - task: "If CASA Tier 2 status note from Phase 1 (01-03-CASA-INTAKE.md) indicates verification in progress, no action; otherwise confirm gmail.send was included in CASA submission scope list"
        location: "Google Cloud Console -> APIs & Services -> OAuth consent screen (verify scopes)"
requirements: [EMAIL-05, EMAIL-06]
must_haves:
  truths:
    - "Voice-match spike runs BEFORE drafting agent build; produces 03-04-SPIKE-VOICE-MATCH.md decision document"
    - "Spike uses 50 stratified held-out sent emails; pairwise judge is Claude Sonnet (frontier — NOT local; breaks judge bias per RESEARCH §Pattern 6)"
    - "Spike decision rule honored: pass = ≥65% Aria win + zero catastrophic; both pass → prefer few-shot; neither pass → ship few-shot with 'beta voice' label (no phase block)"
    - "Drafting agent inserts approval rows in state='ready' with body_original populated; never sends directly"
    - "Drafting agent enters approval state with classifier+routed columns populated (calls Plan 02 router with approvalId)"
    - "Gmail send-scope OAuth uses incremental consent (RESEARCH Shape A): SCOPES.gmail extends to [gmail.readonly, gmail.send]; existing users prompted to re-consent"
    - "src/main/integrations/google/send.ts is the ONLY call site for gmail.users.messages.send; single-send-call-site test asserts matches.length === 1 and path matches exactly"
    - "sendApprovedEmail calls assertApproved(db, id) as FIRST LINE; bypass attempt throws ApprovalGateError"
    - "send_log row written on both ok and error; approval row transitions ready->approved->sent only after successful Gmail API response"
    - "IntegrationsSection shows 'verification-pending' banner when dev build hits unverified Google OAuth app (per RESEARCH §Pitfall 9)"
    - "E2E test: approve a draft → send via mocked Gmail API → verify approval.state='sent', send_log row, message id captured"
  artifacts:
    - path: "scripts/voice-match-eval.ts"
      provides: "One-shot eval runner — samples 50 sent emails, generates pairs, dispatches frontier judge, writes report"
      min_lines: 80
    - path: ".planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-04-SPIKE-VOICE-MATCH.md"
      provides: "Spike result document with win rate, catastrophic count, chosen approach, rationale"
      min_lines: 30
    - path: "src/main/drafting/email.ts"
      provides: "draftReply(db, sourceMessageRow) -> approvalId; few-shot or fine-tune per spike outcome"
      exports: ["draftReply", "DraftSchema"]
    - path: "src/main/integrations/google/send.ts"
      provides: "sendApprovedEmail(db, approvalId) — single send chokepoint"
      exports: ["sendApprovedEmail", "buildRfc2822"]
    - path: "tests/e2e/approve-and-send.spec.ts"
      provides: "Full approve→send E2E with mocked Gmail API"
      min_lines: 60
  key_links:
    - from: "src/main/integrations/google/send.ts"
      to: "src/main/approvals/gate.ts::assertApproved"
      via: "FIRST LINE of sendApprovedEmail"
      pattern: "assertApproved\\(db, approvalId\\)"
    - from: "src/main/drafting/email.ts"
      to: "src/main/approvals/persist.ts::insertApproval + transitionTo"
      via: "draftReply creates approval in pending → generating → ready"
      pattern: "transitionTo.*ready"
    - from: "src/main/integrations/google/auth.ts::SCOPES"
      to: "gmail.send scope"
      via: "incremental consent on existing token (RESEARCH §Pattern 5 Shape A)"
      pattern: "gmail\\.send"
---

<objective>
Two-wave plan landing the final Phase 3 deliverables. **Wave A (spike-first):** Run the voice-match eval before any drafting code is written, record the decision in 03-04-SPIKE-VOICE-MATCH.md. **Wave B (build-on-decision):** Drafting agent on the chosen path, Gmail send-scope OAuth (incremental consent), single-chokepoint send adapter gated by assertApproved, send_log audit, dev verification-pending banner, full E2E.

Purpose: Close EMAIL-05 + EMAIL-06 + ROADMAP success criteria 1 (no send without explicit approval), 3 (approved drafts send via Gmail), 5 (voice match passes held-out eval). The spike-first sequencing is CONTEXT-locked: "Spike runs and decision is made BEFORE building the drafting agent."

Output:
- Wave A: scripts/voice-match-eval.ts runner + eval/pairwise.ts harness + decision document
- Wave B: drafting agent, send adapter (single chokepoint), send_log, dev verification banner, E2E
- Updated single-send-call-site.test asserting exactly ONE call site (now expected = 1 in send.ts)

Plan is autonomous: false — three checkpoints (spike decision review, Gmail send consent on dev machine, post-send E2E human-verify).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-RESEARCH.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-01-approval-queue-tier-config-PLAN.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-02-sensitivity-classifier-redaction-audit-PLAN.md
@.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-03-email-triage-thread-summary-PLAN.md
@.planning/phases/01-foundation/01-03-CASA-INTAKE.md
@src/main/integrations/google/auth.ts
@src/main/integrations/google/gmail.ts
@src/main/llm/router.ts
@src/main/llm/providers.ts
@src/main/lifecycle/scheduler.ts
@src/renderer/features/settings/IntegrationsSection.tsx
</context>

<interfaces>
<!-- From src/main/drafting/eval/pairwise.ts (Wave A) -->
- `const JudgeSchema = z.object({ winner: z.enum(['a','b','tie']), catastrophic: z.boolean(), reason: z.string().max(200) })`
- `interface EvalReport { total: number; ariaWins: number; baselineWins: number; ties: number; catastrophic: number; winRate: number; passed: boolean; approach: 'few-shot'|'baseline'; perItem: Array<{ id; winner; catastrophic; reason }> }`
- `async function runVoiceMatchEval(opts: { db; sampleSize: 50; approach: 'few-shot'|'fine-tune' }): Promise<EvalReport>`

<!-- From src/main/drafting/email.ts (Wave B, post-spike) -->
- `const DraftSchema = z.object({ subject: z.string().max(200), body: z.string().max(5000) })`
- `async function draftReply(db, sourceMessage: GmailMessageRow): Promise<string>` (returns approvalId; row in state='ready' on success, 'interrupted' on crash)

<!-- From src/main/integrations/google/send.ts (Wave B) -->
- `interface SendResult { ok: true; providerMsgId: string }`
- `async function sendApprovedEmail(db, approvalId: string): Promise<SendResult>` — first line: assertApproved
- `function buildRfc2822(args: { to: string[]; subject: string; body: string; inReplyTo: string | null }): string`

<!-- src/shared/ipc-contract.ts additions -->
- `aria.drafting.replyToMessage({ messageId: string }) -> { approvalId: string }`
- `aria.gmail.sendApproved({ approvalId: string }) -> SendResult`
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (Wave A): Voice-match eval harness + run spike + write SPIKE-VOICE-MATCH.md</name>
  <files>scripts/voice-match-eval.ts, src/main/drafting/eval/pairwise.ts, .planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-04-SPIKE-VOICE-MATCH.md</files>
  <behavior>
    Wave 0 RED (eval harness unit-level): tests/unit/drafting/eval/pairwise.test.ts (added during this task)
    - JudgeSchema validates {winner, catastrophic, reason}; rejects unknown winner enum
    - runVoiceMatchEval with mock providers + stub 50-item set → returns EvalReport with winRate = ariaWins/total, passed = (winRate >= 0.65 AND catastrophic === 0)
    - Asserts judge dispatch goes through scheduler.queue
    - Asserts tokenizeForFrontier called per item (since judge prompts contain user sent-mail content per RESEARCH §Pattern 6 / Pitfall 7); disposeDraftTable called in finally

    GREEN:

    pairwise.ts per RESEARCH §Pattern 6:
    - Sample 50 sent emails from SQLite: stratify by (length: short < 200 chars vs long >= 200) × (tone: formal vs casual — heuristic on subject capitalization + word count). Stratify 12-13 per bucket.
    - Exclude the held-out set from any few-shot pool used by the drafting agent (record held-out message IDs in a `voice_match_holdout` table to enforce later — migration 008 added in this task)
    - For each held-out item: take inbound message that triggered the reply (from same thread); generate (a) Aria few-shot draft using remaining sent corpus as exemplars and (b) generic-LLM baseline draft (same frontier model, no few-shot)
    - Both drafts pass through tokenizeForFrontier(approvalId='vm-eval-${itemId}', text) before judge call
    - Judge model: Claude Sonnet via existing @ai-sdk/anthropic provider per RESEARCH §Pattern 6 (CONTEXT decision: frontier judge to break local-judge circularity)
    - judge prompt: "Which reply better matches the user's voice given these exemplars: {3 stratified-similar exemplars}. Reply A: {draftA}. Reply B: {draftB}. Return winner ('a'|'b'|'tie'), catastrophic (true if tone wildly wrong), reason."
    - generateObject(JudgeSchema); rehydrate response (judge output may quote draft tokens); disposeDraftTable in finally
    - All LLM dispatch via scheduler.queue
    - Pass criteria: winRate >= 0.65 AND catastrophic === 0 (CONTEXT-locked)

    scripts/voice-match-eval.ts: tsx entrypoint that opens DB (Phase 1 connect pattern, prompts for passphrase if needed in dev), runs runVoiceMatchEval({ approach: 'few-shot' }), writes report JSON to .planning/phases/03-.../eval-report-few-shot.json. If first approach fails, optionally run with approach: 'fine-tune' if user has set up local LoRA (out-of-scope to build; if Modelfile not present, skip). Final decision documented per CONTEXT rules.

    03-04-SPIKE-VOICE-MATCH.md (written by user / Claude after running script):
    - sample composition (12 short-formal, 13 short-casual, 12 long-formal, 13 long-casual)
    - few-shot win rate, baseline win rate, tie rate, catastrophic count
    - decision: chosen approach + rationale + ship label (production voice / 'beta voice')
    - if neither passed: explicit "ship few-shot with beta voice label" per CONTEXT abort criteria; do NOT block phase
  </behavior>
  <action>Implement per <behavior>. Frontier judge is mandatory (CONTEXT + RESEARCH §Pattern 6); requires Anthropic API key configured per RESEARCH §Environment Availability — if absent, surface a clear error and pause spike; do not silently fall back to local judge (RESEARCH §Pitfall 7 risk). Cost: ~$1-3 per run (RESEARCH §Assumptions A2). Tokenize all sent-mail content before judge dispatch (PII invariant LLM-02). Migration assignment is LOCKED: this plan owns exactly one migration -- `009_voice_match_drafting.sql` -- which creates: (1) `voice_match_holdout` table (id TEXT PRIMARY KEY referencing gmail_message.id, created_at TEXT); (2) adds column `beta_voice INTEGER NOT NULL DEFAULT 0` to the `approval` table UNCONDITIONALLY (the column exists regardless of spike outcome; UI renders the badge only when value=1; the drafting agent sets the column to 1 when the Task 2 checkpoint decision recorded in 03-04-SPIKE-VOICE-MATCH.md is `few-shot-beta`, otherwise leaves the default 0); (3) `send_log` table per RESEARCH Approval Persistence Schema. Register 009 in embedded.ts. The held-out IDs must be excluded from the drafting agent's few-shot corpus (Task 3 enforces this).</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/drafting/eval/pairwise.test.ts && npx tsx scripts/voice-match-eval.ts --dry-run</automated>
  </verify>
  <done>Unit tests green; dry-run executes harness wiring without hitting real APIs; with real API keys the script produces eval-report-few-shot.json; SPIKE-VOICE-MATCH.md captures decision per CONTEXT decision rule.</done>
</task>

<task type="checkpoint:decision" gate="blocking">
  <name>Task 2 (checkpoint): Spike outcome review + drafting approach decision</name>
  <decision>Which drafting approach ships in Task 3?</decision>
  <context>Per CONTEXT decision rule: pass = ≥65% win + zero catastrophic. If both few-shot and fine-tune pass, prefer few-shot. If only one passes, pick it. If neither passes, ship few-shot with visible "beta voice" label (do not block phase).</context>
  <options>
    <option id="few-shot-production">
      <name>Few-shot, production voice label</name>
      <pros>Eval passed; no model artifact; simplest path</pros>
      <cons>None</cons>
    </option>
    <option id="few-shot-beta">
      <name>Few-shot with "beta voice" approval-card label</name>
      <pros>Honors CONTEXT abort criteria; phase ships</pros>
      <cons>User sees beta indicator; capture rejection signal for re-spike in v1.x</cons>
    </option>
    <option id="fine-tune-production">
      <name>Local fine-tune (Ollama Modelfile + LoRA), production label</name>
      <pros>Eval-validated voice match</pros>
      <cons>Heavier ops; v1.x candidate per RESEARCH State-of-the-Art row 3 — only choose if spike showed clear win</cons>
    </option>
  </options>
  <resume-signal>Select: few-shot-production | few-shot-beta | fine-tune-production. Update SPIKE-VOICE-MATCH.md with final decision.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 3 (Wave B): Drafting agent (per spike decision) + IPC + ApprovalCard regenerate wiring</name>
  <files>src/main/drafting/email.ts, src/main/drafting/voiceCorpus.ts, src/main/ipc/drafting.ts, src/shared/ipc-contract.ts, src/renderer/features/approvals/ApprovalCard.tsx, tests/integration/drafting-to-approval.test.ts</files>
  <behavior>
    Wave 0 RED:

    drafting-to-approval.test.ts:
    - draftReply(db, sourceMessage) inserts approval row in 'pending', transitions to 'generating' BEFORE LLM call (Pattern 2 crash-recovery invariant), then 'ready' on success with body_original populated + classifier columns populated (categories_json, severity, classifier_rationale, routed, classifier_version) — these come from Plan 02 router result
    - On router/draft failure: row stays in 'generating' → reapInterruptedOnStartup will sweep next launch (Plan 01 contract). Test simulates by throwing in mock; assert row remains in 'generating' state (NOT auto-marked failed)
    - Held-out message IDs (voice_match_holdout from Task 1) are EXCLUDED from few-shot exemplar pool — assert via spy on voiceCorpus.fetchExemplars
    - All LLM dispatch via scheduler.queue
    - If spike chose `few-shot-beta` label: approval row written with `beta_voice = 1`; ApprovalCard renders beta badge. The `beta_voice` column is declared UNCONDITIONALLY by migration 009 with DEFAULT 0; this task only writes value=1 when the checkpoint selected the beta-voice option, otherwise the default stands.

    GREEN per chosen approach (Task 2 decision):

    voiceCorpus.ts: fetchExemplars(db, sourceMessage, k=5) — query sent gmail_message rows with similar (subject length bucket, tone heuristic, recipient overlap) ORDER BY received_at DESC LIMIT k. EXCLUDE WHERE id IN (SELECT id FROM voice_match_holdout).

    email.ts: draftReply implementation:
    1. crypto.randomUUID() for approvalId
    2. insertApproval(db, { kind:'email_send', source_message_id: sourceMessage.id, recipients: [reply target], subject: 'Re: '+sourceMessage.subject }) — state defaults to 'pending'
    3. transitionTo(db, id, 'generating') BEFORE any LLM call (RESEARCH §Pattern 2)
    4. exemplars = await fetchExemplars(...)
    5. prompt = buildFewShotPrompt(exemplars, sourceMessage)
    6. router({ prompt, approvalId: id }) → returns { text, classifierResult, routed } — uses Plan 02 router (tokenize+rehydrate happens inside on hybrid path)
    7. parsed = generateObject(DraftSchema, { prompt, model: router.chosenModel }) via scheduler.queue
    8. transitionTo(db, id, 'ready', { body_original: parsed.body, subject: parsed.subject, categories_json, severity, confidence, classifier_rationale, classifier_version, routed }) — persists classifier result frozen at ready time per schema spec
    9. Return approvalId
    On error during 4-8: leave row in 'generating'; rely on next-launch sweep (Pattern 2).

    ipc/drafting.ts: aria.drafting.replyToMessage({ messageId }) → loads gmail_message, calls draftReply, returns { approvalId }. ApprovalCard "Regenerate" button (placeholder from Plan 01) wires to aria.drafting.replyToMessage with the source_message_id, then transitions interrupted → generating.

    If decision = few-shot-beta: render small "Beta voice" badge on ApprovalCard via approval.beta_voice column.
  </behavior>
  <action>Implement chosen approach from Task 2 checkpoint. Drafting agent NEVER sends — only inserts an approval row in 'ready'. Plan 01's gate.ts + Task 4's send adapter handle the send authorization. All LLM dispatch via scheduler.queue. Per RESEARCH §Pattern 2 crash-recovery: transitionTo('generating') MUST happen before the LLM call so a mid-call crash leaves a recoverable row. Use router from Plan 02 — drafting inherits PII tokenize+rehydrate + forced-local routing automatically. voiceCorpus exclusion guarantees the held-out 50 never pollute few-shot exemplars (eval integrity).</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/drafting && npm run test -- tests/integration/drafting-to-approval.test.ts</automated>
  </verify>
  <done>Integration green; draftReply produces 'ready' approval with classifier columns populated; held-out exclusion enforced; crash mid-draft leaves row in 'generating' for Plan 01 sweep; ApprovalCard regenerate button calls drafting IPC.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4 (Wave B): Gmail send-scope OAuth + send adapter (single chokepoint) + send_log + verification banner</name>
  <files>src/main/integrations/google/auth.ts, src/main/integrations/google/send.ts, src/main/integrations/google/sendLog.ts, src/main/ipc/gmail-send.ts, src/shared/ipc-contract.ts, src/renderer/features/settings/IntegrationsSection.tsx, tests/unit/integrations/google/send.test.ts, tests/static/single-send-call-site.test.ts</files>
  <behavior>
    Wave 0 RED:

    tests/unit/integrations/google/send.test.ts:
    - sendApprovedEmail with unknown approvalId → throws ApprovalGateError code='not-found' (proves assertApproved is first line)
    - sendApprovedEmail with approval state='ready' (not 'approved') → throws code='not-approved'
    - sendApprovedEmail with approved row + mocked Gmail API success → returns { ok:true, providerMsgId }; writes send_log row with ok=1, provider_msg_id; UPDATEs approval to state='sent', sent_at populated
    - sendApprovedEmail with approved row + mocked Gmail API failure → writes send_log row with ok=0, error; row stays in 'approved' (no false 'sent' transition); throws
    - severity=high + approval_path='silent' approval → throws code='forced-explicit-missing' (proves APPR-07 reaches send via gate)
    - buildRfc2822 with inReplyTo populated → includes In-Reply-To AND References headers per Gmail threading requirement

    tests/static/single-send-call-site.test.ts (UPDATE from Plan 01): now expect matches.length === 1 AND match.file === 'src/main/integrations/google/send.ts'. Update assertion.

    GREEN per RESEARCH §Example 2 and §Pattern 5 Shape A:

    auth.ts SCOPES.gmail extends to `['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']`. Phase 2 already uses prompt=consent (RESEARCH §Pitfall 4 — preserve). Existing Phase 2 users see Settings → Integrations banner: "Aria needs additional permission to send mail — Re-connect Gmail" → triggers connectGoogle('gmail') with new scope set. The new refresh token replaces old via setGoogleTokens (existing helper).

    send.ts per RESEARCH §Example 2 verbatim. FIRST LINE: `assertApproved(db, approvalId)`. sendLog write happens whether success or failure. State transition 'approved' → 'sent' only on Gmail API success.

    sendLog.ts: writeSendLog helper (or import from Plan 01's persist.ts if it landed there) inserting into send_log table.

    ipc/gmail-send.ts: aria.gmail.sendApproved({ approvalId }) → sendApprovedEmail; returns SendResult.

    IntegrationsSection.tsx: detect when sending against unverified app (catch 403 with 'access_denied'/'unverified_app' indicator from googleapis error) and show persistent banner: "Aria is awaiting Google verification (CASA Tier 2 in progress). Sending may fail until verification clears." Per RESEARCH §Pitfall 9. Banner state stored in app settings; clears once a successful send occurs.
  </behavior>
  <action>Implement per <behavior> and RESEARCH §Example 2. Single-call-site invariant enforced by static grep test — if any other code path imports gmail or calls users.messages.send, the test fails. Threading: In-Reply-To + References headers required for Gmail to thread the reply correctly. Use Buffer.from(...).toString('base64url') for raw field (RESEARCH §Example 2 exact). Refresh-token rotation: rely on existing OAuth2Client('tokens') listener wired in Phase 2 auth.ts line ~324 (RESEARCH §Don't Hand-Roll). Verify CASA submission included gmail.send before relying on production scope per RESEARCH A6 (planner pre-checked 01-03-CASA-INTAKE.md per Phase 2 carry-forward).</action>
  <verify>
    <automated>npm run test:unit -- tests/unit/integrations/google/send.test.ts tests/static/single-send-call-site.test.ts</automated>
  </verify>
  <done>Unit green; send.ts is the only file matching `gmail.users.messages.send` grep; bypass test (unapproved id) throws; success path writes send_log + transitions to 'sent'; failure path writes send_log + preserves 'approved' state.</done>
</task>

<task type="checkpoint:human-action" gate="blocking">
  <what-built>Gmail send-scope incremental consent + verification-pending banner.</what-built>
  <how-to-verify>
    1. Open dev build; navigate to Settings → Integrations.
    2. Click "Re-connect Gmail" — browser opens Google consent screen showing TWO scopes ("Read your Gmail" + "Send mail on your behalf"). If only the read scope appears, OAuth state is wrong — see RESEARCH §Pitfall 4.
    3. Approve consent.
    4. Return to app; integrations row should show "gmail (read + send)" or similar. If the consent screen showed "unverified app" warning, the verification-pending banner should now be visible in IntegrationsSection. Both are acceptable in dev.
    5. Confirm refresh token re-persisted (no errors in pino log).
  </how-to-verify>
  <resume-signal>Type "approved" once consent is granted and the new token is in safeStorage; describe issues otherwise.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 5 (Wave B): E2E approve→send + bypass attempt + briefing → /approvals → send flow</name>
  <files>tests/e2e/approve-and-send.spec.ts</files>
  <behavior>
    Playwright _electron E2E:
    1. MSW mock for gmail.users.messages.send returning { id: 'mocked-msg-id' }
    2. Seed approval row in 'ready' with non-sensitive payload + classifier columns populated
    3. Launch app; navigate to /approvals
    4. Click "Approve" on the card; assert IPC call results in state='approved' then sendApprovedEmail invoked
    5. Assert MSW mock received exactly one request; raw field is base64url decodable and contains To/Subject/In-Reply-To/body
    6. Assert approval row state='sent', sent_at populated, send_log row exists with ok=1 and provider_msg_id='mocked-msg-id'

    Bypass-attempt sub-test:
    7. Insert second approval row in state='ready' (NOT approved). Call aria.gmail.sendApproved({ approvalId }) directly via app.evaluate IPC; assert it throws ApprovalGateError code='not-approved'; assert MSW mock NOT invoked.

    Forced-explicit sub-test:
    8. Insert third approval row with severity='high', approval_path='silent', state='approved' (synthetic — simulates someone bypassing UI disable). Call sendApproved; assert throws code='forced-explicit-missing'; assert MSW mock NOT invoked.
  </behavior>
  <action>Implement per <behavior>. MSW handlers go in tests/mocks/gmail-send.ts (per RESEARCH §Wave 0 Gaps). E2E is the proof for ROADMAP success criteria 1 (no send without approval) and 3 (approved drafts send via Gmail).</action>
  <verify>
    <automated>npx playwright test tests/e2e/approve-and-send.spec.ts</automated>
  </verify>
  <done>E2E green; bypass attempts throw; forced-explicit invariant verified end-to-end; MSW mock asserts exactly one send per approved draft.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>End-to-end "first email sent" experience: triage → draft → approve → send via real Gmail (dev/test account).</what-built>
  <how-to-verify>
    1. Ensure Gmail is connected with send scope (prior checkpoint).
    2. Send yourself a test email from another account (or use an existing recent inbound message).
    3. Wait for next sync (≤5 min) or trigger manual sync via Settings.
    4. Open /approvals — verify a draft reply is present in state='ready' with triage chips, classifier chip, and a body preview.
    5. Click "Edit" — modify a sentence; click "Save & Approve".
    6. Verify card transitions to 'approved' then 'sent' within a few seconds.
    7. Open Gmail web → Sent folder — confirm the message is present, body matches your edits, and it threads under the original message (In-Reply-To worked).
    8. Open /routing-log — confirm a row exists for the drafting LLM call with classifier rationale and route= (local|hybrid).
    9. Open Settings → verify send_log entry visible (or via dev SQL: SELECT * FROM send_log ORDER BY ts DESC LIMIT 1; expect ok=1).
  </how-to-verify>
  <resume-signal>Type "approved" if all 9 steps pass; otherwise describe failures.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → IPC → send adapter | Untrusted renderer cannot reach Gmail send except via sendApprovedEmail IPC which calls assertApproved first |
| Send adapter → Gmail API (HTTPS) | Outbound TLS; OAuth bearer token from safeStorage |
| Voice-match eval → frontier judge | Defensible PII exception: user opted into eval, held-out set only, tokens rehydrated locally before judge output is read (RESEARCH §Pattern 6) |
| Drafting agent → Plan 02 router | Reuses tokenize+rehydrate; HR/legal/financial≥med routes local |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-04-01 | Elevation of Privilege | Send call without approved row | mitigate | assertApproved FIRST LINE in send.ts (RESEARCH §Example 2); unit test bypass-attempt; E2E bypass sub-test; static grep enforces single call site. |
| T-03-04-02 | Elevation of Privilege | APPR-07 severity=high bypassed via direct IPC | mitigate | assertApproved checks approval_path='explicit' for forced categories; unit + E2E sub-test (Task 5 step 8). |
| T-03-04-03 | Information Disclosure | Drafting prompt contains PII sent to frontier | mitigate | Drafting uses Plan 02 router; tokenize+rehydrate auto-applied on hybrid; HR/legal/financial forced local. |
| T-03-04-04 | Information Disclosure | Voice-match eval sends user sent-mail to frontier judge | mitigate (defensible exception) | Tokenize before judge dispatch; rehydrate locally; only held-out set sent; user explicitly opted into eval via running the script (RESEARCH §Pattern 6). |
| T-03-04-05 | Tampering | Edit-then-approve mutates body server-side without re-classification | accept v1 | Edits go through transitionTo('approved', { body_edited }) — classifier columns are frozen at 'ready' time. Risk: user edits in PII that wasn't classified. Mitigation: forced-explicit still triggers from original classifier; user-eye remains the gate. Document; v1.x can re-classify on edit. |
| T-03-04-06 | Repudiation | Send happens but no send_log row | mitigate | writeSendLog in same code block as Gmail API call, on both ok AND error paths; unit test asserts. |
| T-03-04-07 | Denial of Service | OAuth refresh failure mid-send | mitigate | google-auth-library OAuth2Client('tokens') listener already wired (Phase 2); on 401, library auto-refreshes; if refresh itself fails, EMAIL-07 re-auth banner (Phase 2 pattern) surfaces. |
| T-03-04-08 | Spoofing | Phishing OAuth consent screen mimics Aria | accept | Out of phase scope; addressed by Phase 8 code-signing (XCUT-05). |
| T-03-04-09 | Tampering | User-system-clock manipulation bypasses snooze | accept v1 | User owns machine (CONTEXT trust posture); documented; v1.x monotonic clock. |
| T-03-04-10 | Information Disclosure | Gmail returns recipient-doesn't-exist; bounce content logged | mitigate | send_log.error column stores error message; pino redact sink (XCUT-03) covers; do not log full Gmail API response body to console. |
</threat_model>

<verification>
- EMAIL-05 (drafts in user voice; enter Approval Queue): drafting-to-approval integration test + spike pass (≥65% win) per SPIKE-VOICE-MATCH.md.
- EMAIL-06 (send-scope OAuth + send via Gmail): send.test.ts + auth.ts SCOPES extension + checkpoint Task 6 manual verification.
- APPR-01 (no send without approval): static grep test (single call site) + send.test.ts bypass case + E2E bypass sub-test (ROADMAP SC 1).
- APPR-07 (forced-explicit reaches send): send.test.ts severity=high case + E2E sub-test (Task 5 step 8).
- ROADMAP SC 3 (approved drafts send via Gmail; appear in Sent): E2E + checkpoint Task 7 step 7.
- ROADMAP SC 5 (voice match passes held-out eval): SPIKE-VOICE-MATCH.md decision document; CONTEXT decision rule honored.
- LLM-02 (preserved through drafting): drafting uses Plan 02 router → tokenize/rehydrate + forced-local routing inherited.
- Verification-pending banner shown when CASA unverified (RESEARCH §Pitfall 9): IntegrationsSection 403-detection logic.
</verification>

<success_criteria>
- SPIKE-VOICE-MATCH.md exists with sample composition, win rates, catastrophic count, decision, ship label
- Drafting agent produces approvals; held-out 50 excluded from few-shot exemplar pool
- src/main/integrations/google/send.ts is the only file matching `gmail.users.messages.send` (static test asserts matches.length === 1)
- assertApproved is the first executable line of sendApprovedEmail (unit + E2E enforce)
- send_log row written on every send attempt (success + failure)
- Approval row transitions 'approved' → 'sent' ONLY on Gmail API success
- E2E: approved draft sent via mocked Gmail; bypass-attempt throws; forced-explicit case throws
- Manual checkpoint: real Gmail Sent folder confirms message + threading
- ROADMAP success criteria 1, 3, 5 all demonstrably met; phase 3 complete
</success_criteria>

<output>
After completion: `.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-04-SUMMARY.md`
</output>
