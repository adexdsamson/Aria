# Phase 14: Voice Safety / Confirm Contract - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Build and **enforce** the voice-to-approval safety contract — **before** any audio (Phase 15), any conversational fluency (Phase 16), or any voice-driven writes (Phase 17). This phase ships the *contract and its guards*, not the voice experience.

The contract guarantees three things, all provable headlessly (no audio):
1. A voice-staged action can be staged but **never auto-executed** — it sits as an approval row awaiting a separate explicit confirm turn.
2. A voice confirm can **never** authorize a high-stakes action — forced categories (financial/legal/HR) and `severity==='high'` are rejected by the gate, forcing the on-screen typed/clicked confirm.
3. The voice path is **structurally prevented** (build-time ratchet) from calling write modules directly — it must route through the same staging + `assertApproved` chokepoint the UI uses.

**In scope:** `approval_path` model extension + CHECK-widening migration; the `assertApproved` gate change; the dormant headless `voiceConfirm()` seam; the static-ratchet enforcement; the failing-then-passing gate test; reconciliation of the stale `ARCHITECTURE.md` voice-confirm description.

**Out of scope (Phases 15/16/17):** any audio capture / STT / TTS / mic handling (15); streaming/barge-in (16); the actual voice intent handler, read-back of resolved entities, dual-channel UX, mishear recovery, cloud opt-in, voice settings (17).

</domain>

<decisions>
## Implementation Decisions

### Gate enforcement shape (Q1 → Named branch + migration, "B+D")
- **D-01:** Add `'voice-explicit'` as a new value to the `ApprovalPath` union (`src/main/approvals/persist.ts:25`, currently `'explicit' | 'silent'`).
- **D-02:** Add an **explicit, named** rejection branch to `assertApproved` (`src/main/approvals/gate.ts`) that throws a **new dedicated error code** (e.g. `ApprovalGateError('voice-forbidden-forced', …)`) when a row is forced/high-severity AND `approval_path === 'voice-explicit'`. This is intentional defense-in-depth duplicating the existing line-89 `!== 'explicit'` rule, so a future refactor of the generic branch cannot silently reopen the voice path. Order the branch so it fires within/before the generic forced check.
- **D-03:** A **CHECK-widening migration is mandatory** (not optional). Every materialized form of the `approval` table pins `approval_path CHECK IN ('explicit','silent')` — migrations 006/010/012a/124 **and** the `embedded.ts` snapshot that fresh test DBs run. Without widening the CHECK to include `'voice-explicit'`, inserting a voice row throws a raw SQLite error *before* the gate runs. The migration MUST update both the live-table rebuild chain **and** `src/main/db/migrations/embedded.ts` (and the pre-012a snapshot fixture) or fresh test DBs and migrated DBs split-brain.
- **D-04:** Voice must write `'voice-explicit'` from its **own** handler. The UI click sites (`src/main/ipc/approvals.ts:182, :351`) hardcode `approval_path:'explicit'` — the voice path must never reuse those sites.

### Staged-state mapping (Q2 → Map "draft" → existing `ready`, "A")
- **D-05:** The roadmap's `state='draft'` (SC1) is **fictional** against the real state machine. Map it to the existing **`ready`** state. `ready → approved` is the *only* legal edge into `approved` (`src/main/approvals/state.ts:28`) and is the exact transition the UI fires (`src/main/ipc/approvals.ts:199`) — so SC4 ("the SAME approve() transition the UI performs") is true **by construction**, with zero state-machine churn.
- **D-06:** Do **not** add a new state. A new `draft` state would create a *parallel* `draft→approved` edge that diverges from the UI path (breaking SC4) and would touch 6+ consumers (`ApprovalState` union, `ALLOWED` table, `ApprovalsScreen` `state==='ready'` checks at :126, the batch guard at `approvals.ts:348`, `listApprovals`, and the crash-recovery sweep — which only reaps `generating`, so a stranded `draft` would never be swept). A stranded `ready` row is already a safe inert resting state.
- **D-07:** Voice provenance lives **off the state axis** — it is carried by `approval_path='voice-explicit'` (from D-01). No separate provenance column is needed. Staging itself reuses the existing `insertApproval` path (triage/drafting/scheduling already create rows); Phase 14 adds **no** new staging function — only the confirm seam (see D-10).

### Voice write-path static ratchet (Q3 → Combo, "D")
- **D-08:** Ship **two** complementary static specs (vitest, matching the existing `tests/static/*` ratchet family idiom — walk `src/main`, strip comments, diff against an explicit `ALLOWED` set):
  - **(B) Caller allow-list** on the three exported chokepoint entry points — `sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions` — asserting the ONLY importers/callers are the known IPC chokepoints (`src/main/ipc/gmail-send.ts`, `src/main/ipc/approvals.ts`, `src/main/integrations/todoist/...`/`src/main/ipc/todoist.ts`). Fail-closed against *any* rogue caller (voice or otherwise) from day one.
  - **(A) Named voice spec** — `tests/static/voice-routes-through-staging.spec.ts` keyed to the planned `src/main/voice/**` namespace, reading exactly like SC3's wording so an auditor can point to it.
- **D-09:** The existing write-site ratchets guard only the *low-level SDK surface* (`events.patch`, `messages.send`) — **not** the exported chokepoint entry points, which is exactly the gap a voice handler would exploit. Option B closes that real hole; Option A documents intent. The allow-list regex must match BOTH the `import { fn } from '…'` site and the call site, because the three entry points have heterogeneous signatures (`sendApprovedEmail(db, id, deps)` / `applyCalendarChange(db, id, deps)` are positional; `pushApprovedMeetingActions({ db, approvalId, client })` is a single options object).
- **D-09a:** Consider extending the ratchet to also assert **no `src/main/voice/**` file writes `approval_path:'explicit'`** (it must write `'voice-explicit'`), mirroring D-04 — leave the exact form to planning.

### Phase-14 contract surface (Q4 → Contract + dormant headless seam, "Option 2")
- **D-10:** Ship a **pure, dormant, headless** `voiceConfirm(db, approvalId): void` in a new `src/main/voice/confirm.ts` that internally calls `transitionTo(db, id, 'approved', { approval_path: 'voice-explicit' })`. No audio, no IPC wiring, no callers shipped this phase — fully unit-tested. This is the **`writeSendLog` precedent** (`persist.ts:281` — "dormant… exists so the contract is fixed up front"), and `ARCHITECTURE.md:122` already names `confirm.ts` "the load-bearing trust decision."
- **D-11:** Keep the signature to **`(db, approvalId)` only** to avoid Phase-17 churn. Do NOT define a read-back payload type this phase (deferred — read-back is squarely Phase 17 / VOICE-05/08/09/11, and freezing it before any resolver exists invites a fictional schema, a known Aria failure mode).
- **D-12:** SC verification this phase, all audio-free:
  - **SC2 (failing-then-passing):** a gate test that a forced/high row with `approval_path='voice-explicit'` throws `voice-forbidden-forced`, and (after the branch lands) a low/med voice-explicit row passes.
  - **SC4 (same transition + unchanged adapter):** call `voiceConfirm(db, id)` then `sendApprovedEmail(...)` and assert the unified send adapter's first-line `assertApproved` (`src/main/integrations/send.ts:146`) runs unchanged.

### Required corpus correction (surfaced during research — must land this phase)
- **D-13:** **`ARCHITECTURE.md` is stale and self-contradictory with the rest of the planning corpus.** Lines 122/306/315 describe voice-confirm as producing `approval_path='explicit'` ("a first-class explicit approval"). This directly conflicts with `ROADMAP.md`, `research/SUMMARY.md`, and `research/PITFALLS.md`, which specify the new `'voice-explicit'` value that must NOT satisfy the forced-explicit override. The ROADMAP/PITFALLS position is correct (the only one consistent with SC2 — a forced-category voice confirm must be *rejectable*, which requires a distinguishable path value). **Correct `ARCHITECTURE.md:122/306/315` to the `'voice-explicit'` design during this phase** (reconcile-via-addendum, the established "spec vs codebase reality" loop).

### Claude's Discretion
- Exact migration number/filename and whether the CHECK is widened in-place vs a full table rebuild (follow the existing migration chain conventions).
- Exact regex form of the two ratchet specs and whether D-09a folds into the named spec or the allow-list spec.
- Whether `voiceConfirm` lives in `src/main/voice/confirm.ts` exactly as named (recommended — matches ARCHITECTURE.md) or a sibling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The safety contract being extended (ground truth — read first)
- `src/main/approvals/gate.ts` — `assertApproved`, `ApprovalGateError`, `FORCED_CATEGORIES`, the forced-explicit branch (~line 89). The single send-authorization chokepoint. **This is where D-02 lands.**
- `src/main/approvals/persist.ts` — `ApprovalPath = 'explicit' | 'silent'` (line 25, **D-01 extends this**), `transitionTo` (line 211, the only mutation path), `ApprovalRow` shape, and the `writeSendLog` dormant-contract precedent (line 281, **the D-10 pattern**).
- `src/main/approvals/state.ts` — the full state machine; `ready: ['approved', …]` (line ~28) is the load-bearing edge for D-05; `assertTransition`.
- `src/main/integrations/send.ts` — the unified send adapter; calls `assertApproved` as its first line (~line 146). The SC4 integration target.
- `src/main/integrations/write-event.ts`, `src/main/integrations/todoist/push-actions.ts` — the other two write modules the ratchet must protect.
- `src/main/ipc/approvals.ts` — UI approve handlers (`:182`, `:199`, `:351`); they hardcode `approval_path:'explicit'` (D-04) and contain the `state!=='ready'` batch guard.

### Static-ratchet family (idiom to mirror for D-08)
- `tests/static/single-calendar-write-site.test.ts` — the canonical ratchet shape (walk + stripLineComments + ALLOWED set + offenders assertion).
- `tests/static/single-mail-send-site.test.ts`, `tests/static/single-entitlement-gate-site.test.ts`, `tests/static/phase12-bans.spec.ts` — additional family members.

### Migration / schema (mandatory for D-03)
- `src/main/db/migrations/embedded.ts` — the snapshot fresh test DBs run; **must** be updated alongside the live migration or split-brain.
- `src/main/db/migrations/006_approvals_and_tier.sql` (+ 010/012a/124) — where the `approval_path CHECK IN (...)` constraint is pinned.

### Planning corpus (note the D-13 contradiction)
- `.planning/ROADMAP.md` § Phase 14 — goal, 4 success criteria, locked v2.0 decisions. **Authoritative on `'voice-explicit'`.**
- `.planning/REQUIREMENTS.md` — VOICE-10 (this phase's only requirement).
- `.planning/research/PITFALLS.md` §§23–30 — `'voice-explicit'` must NOT satisfy forced-explicit; "voice can never set `approval_path='explicit'`" ratchet. **Authoritative.**
- `.planning/research/ARCHITECTURE.md` §§122/306/315 — **STALE / WRONG** on the path value (says `'explicit'`). Names `confirm.ts` as "the load-bearing trust decision" (correct). **Correct per D-13.**
- `.planning/research/SUMMARY.md` §73 — corroborates `'voice-explicit'`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `transitionTo(db, id, to, patch)` (`persist.ts:211`) — `voiceConfirm` (D-10) wraps this with `to='approved'`, `patch={approval_path:'voice-explicit'}`. No new mutation primitive needed.
- `assertApproved` (`gate.ts`) — already rejects non-`'explicit'` paths for forced/high; D-02 adds a *named* branch on top for auditability rather than replacing the logic.
- `writeSendLog` (`persist.ts:281`) — the precedent for shipping a fully-typed, dormant, zero-caller contract function up front. `voiceConfirm` follows it exactly.
- The `tests/static/*` ratchet machinery (`walk` + `stripLineComments` + `ALLOWED` + offenders) — copy the idiom for both D-08 specs.

### Established Patterns
- **Named, typed error codes** on the gate (`not-found` / `not-approved` / `forced-explicit-missing`) — D-02 extends this set with `voice-forbidden-forced`.
- **Per-mechanism static ratchet** — every safety mechanism in the repo carries one; voice gets two (D-08).
- **esbuild skips tsc** — build-time guards MUST be vitest static tests, not type-only (per project memory). Run `npm run typecheck` after main edits.
- **Provenance off the state axis** — `approval_path` already encodes orthogonal provenance ('explicit'/'silent'); 'voice-explicit' extends that axis rather than the state axis.

### Integration Points
- `voiceConfirm` → `transitionTo` → (Phase 17) the voice intent handler will call `voiceConfirm` then the existing in-process send/calendar/task services.
- The CHECK migration plugs into the existing migration chain + `embedded.ts` snapshot.
- The ratchet plugs into the existing `tests/static/` CI suite.

</code_context>

<specifics>
## Specific Ideas

- The phase is deliberately sequenced FIRST in v2.0 specifically so the safety contract is provable and enforced before any audio tempts a shortcut. Treat "no audio yet" as a feature: everything here is a headless unit/integration/static test.
- `voiceConfirm(db, approvalId)` — signature frozen at exactly two args to immunize Phase 17 against a signature re-litigation.
- The failing-then-passing gate test (SC2) is the centerpiece deliverable — it must assert the *specific* `voice-forbidden-forced` code, not the generic one.

</specifics>

<deferred>
## Deferred Ideas

- **Read-back payload type** (`VoiceReadBack`: resolved contact email, absolute tz date/time, never raw transcript) — Phase 17 (VOICE-05/08/09). Defining it now invites a fictional schema before a resolver exists.
- **Orthogonal `confirm_channel` column** (screen/voice/system/watch) — revisit in v2.1 only if 2+ more confirm channels arrive. Over-engineered for a single voice channel now.
- **The actual voice intent handler + IPC channel** (`VOICE_CONFIRM`) and its handler-count/db-null-skip-set wiring — Phase 17.
- **Mishear recovery** (spoken cancel/stop/never-mind) — Phase 17 (VOICE-11).
- **`stageVoiceAction()` dedicated staging seam** — not needed; staging reuses existing `insertApproval`. Only revisit if Phase 17 finds staging needs voice-specific shaping.

</deferred>

---

*Phase: 14-voice-safety-confirm-contract*
*Context gathered: 2026-06-02*
