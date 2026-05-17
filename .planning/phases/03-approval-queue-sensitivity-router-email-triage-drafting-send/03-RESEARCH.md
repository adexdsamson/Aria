# Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send — Research

**Researched:** 2026-05-17
**Domain:** Local-first Electron app — persisted approval queue + Zod-structured local LLM classifier + hybrid PII redaction + Gmail send
**Confidence:** HIGH on stack + persistence patterns (entirely reusable from Phase 1/2); MEDIUM on `generateObject` adherence over Ollama (mitigation strategy below); MEDIUM on voice-match fine-tune (recommendation: defer fine-tune, ship few-shot)

## Summary

Phase 3 is mostly an **assembly** of pieces that already exist in the Aria codebase — the new work is (a) a persisted Approval Queue with state machine, (b) a Zod-shaped LLM classifier on top of the existing `LLMRouter`, and (c) a thin Gmail send adapter. The redaction helpers, OAuth abstraction, p-queue scheduler, routing_log, `generateObject` + Zod patterns, and Settings UI surface are all in place from Phase 2 and must be reused, not rebuilt.

The main external risk is **`generateObject` reliability over Ollama for the sensitivity classifier**. The community consensus is that small local models (7-8B) return malformed JSON often enough that a bounded retry loop + a hard-rules prefilter is mandatory for production. Aria already has the prefilter (`src/main/llm/classifier.ts` regex hard-rules + `redactAllPii`); the new LLM classifier should *augment* that filter, not replace it — the regex layer handles 100% of the obvious cases, the LLM only resolves categorical ambiguity (financial vs legal vs hr) and severity.

**Primary recommendation:** Build the v1 sensitivity classifier as a **two-stage pipeline** (regex prefilter → LLM categorization with bounded retry + fallback to regex-only). Persist approvals in a single polymorphic `approval` table from day 1 (Phase 4 will add calendar items). Defer local fine-tuning entirely — ship few-shot voice match with a held-out pairwise judge using **Claude Sonnet** as the judge (frontier, not Ollama, to avoid judge-bias circularity).

## Project Constraints (from CLAUDE.md)

The planner MUST honor these directives — same authority as locked CONTEXT.md decisions:

- **Workflow:** Direct file edits forbidden outside a GSD command — use `/gsd-execute-phase` for Phase 3 implementation.
- **Stack pins (immutable for this phase):** Electron `41.6.1` (SQLCipher ABI — Phase 1 blocker); React 18 + Vite 5; TypeScript 5; Tailwind 3.4; shadcn/ui.
- **LLM SDK:** Vercel AI SDK `^6.0.0` with `generateObject` + Zod; provider packages `@ai-sdk/anthropic ^3`, `@ai-sdk/openai ^3`, `@ai-sdk/google ^3`, `ollama-ai-provider-v2 ^3` (NOT legacy `ollama-ai-provider`).
- **Local model:** Ollama localhost:11434, OpenAI-compatible. Default = `llama3.1:8b-instruct-q4_K_M` (Phase 1 pin in `src/main/llm/providers.ts`).
- **DB:** `better-sqlite3-multiple-ciphers ^12` (SQLCipher whole-DB encryption); single-writer synchronous; keys via `safeStorage` (Keychain/DPAPI/libsecret).
- **Secrets:** `safeStorage` only; refuse `basic_text` Linux backend; never SQLCipher for secrets.
- **OAuth:** `googleapis ^144` + `google-auth-library ^9`; loopback IP + PKCE; refresh token in `safeStorage`.
- **Scheduling:** `node-cron ^4` + `p-queue ^9` (concurrency 1) — already registered in `src/main/lifecycle/scheduler.ts`. **All Phase 3 LLM calls must enqueue through the existing scheduler handle.**
- **Trust posture:** Aria does NOTHING irreversible without explicit user approval; one surprise send destroys the product.
- **Privacy:** User data never leaves the machine except as scoped LLM prompts to frontier APIs; sensitive content forced local; redacted before frontier hits.
- **No HIPAA, no PCI in v1**; OAuth least-privilege.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Approval Queue UX + state**
- **Surface:** Both — inline preview in briefing (top-N pending) AND dedicated `/approvals` detail view with full queue. Briefing shows count badge; deep-link to detail.
- **Card actions (v1 full set):** Approve, Edit-then-approve (inline edit + diff stored for APPR-04), Reject (with optional reason captured for learning), Snooze (until time/condition), Batch approve (multi-select with explicit confirmation UX).
- **State machine states:** `pending → generating → ready → (approved|rejected|snoozed) → sent`. `sent` only from `approved`. `generating` failures land in `interrupted`.
- **Crash recovery:** Mid-generation drafts surface as `interrupted` on next launch with a clear badge; user clicks "regenerate" to retry. No auto-retry on launch.
- **Persistence:** Queue items survive app restart (APPR-05) — better-sqlite3 table, written before each state transition.
- **Tier config schema:** APPR-06 schema must exist and be enforced by the gate. v1 ships with `always-confirm` default for all sends; per-recipient allowlist UI deferred to v1.x. Schema must support silent/explicit/always-confirm tiers and per-content-class overrides (APPR-07).

**Sensitivity router design**
- **Classifier output (Zod via `generateObject`):** `{ categories: [financial|legal|hr|pii|urgent|none], severity: low|med|high, confidence: 0-1, rationale: string }`. Multi-label.
- **Redaction strategy (hybrid):**
  - Token substitution + re-hydration for general PII routed to frontier (PERSON_N, EMAIL_N, AMT_N, ORG_N, PHONE_N)
  - Route **entirely local** (no frontier call) when categories include `hr`, `legal`, or `financial` at severity ≥ med
  - Re-hydration happens local-side after frontier response; tokens must be deterministic per-task and never leak across tasks
- **Forced-explicit (APPR-07):** Any draft whose classifier flags `severity: high` OR any of `financial|legal|hr` is forced to explicit approval regardless of tier.
- **Audit log:** Both surfaces ship — (a) inline chip on each draft/triage item showing `routed: local | frontier | hybrid` with click-to-expand classifier rationale, AND (b) full searchable `/routing-log` view: one row per LLM call with input hash, categories, severity, model, rationale, timestamp.

**Triage rationale + priority**
- **Rationale format:** `{ signals: [from-vip, thread-active, deadline-mentioned, money-amount, awaiting-reply, mention, ...], summary: string }`.
- **Priority buckets (4):** `urgent / needs-you / fyi / archive`.
- **Storage:** Store once with the triage decision (immutable audit trail). Persist classifier version. No background re-rationale in v1.
- **Surfacing:** Tags chips next to subject; summary as inline `why` line. Both visible in queue card without expanding.

**Voice-match spike + eval**
- **Method:** Pairwise LLM-as-judge on 50 stratified held-out sent emails (short/long/formal/casual).
- **Threshold:** ≥65% pairwise win + no catastrophic losses (zero "wildly wrong tone").
- **Decision rule:** Pick approach clearing bar with higher margin. If both clear: prefer few-shot. If only one: pick it. If neither: ship few-shot with "beta voice" label; do NOT block phase.
- **Order:** Spike runs and decision made BEFORE building drafting agent.

**Cross-cutting**
- **All LLM calls** through p-queue (existing `src/main/lifecycle/scheduler.ts` handle).
- **Gmail send scope** requested separately from read-scope; explanatory consent prompt. CASA-approved credentials path; verification-pending banner OK for dev.

### Claude's Discretion

- Approval table schema shape (polymorphic vs per-kind) — research recommends polymorphic single table.
- Token substitution hashing algorithm (research recommends per-draft random salt + counter, NOT cross-draft global).
- LLM call retry/fallback policy on Zod-schema-validation failure (research recommends bounded 2-retry + regex fallback).
- Crash-recovery test harness shape — research recommends `process.kill(SIGKILL)` in a Playwright `_electron` test or a unit-level transition-interruption test.
- Approval Queue UI component decomposition (cards, batch toolbar, edit-then-approve diff component).
- Voice-match few-shot example selection (recent N sent emails vs persona-stratified — recommend persona-stratified).
- Pairwise judge model (research recommends Claude Sonnet via existing Anthropic provider — frontier, not local, to avoid judge bias).

### Deferred Ideas (OUT OF SCOPE)

- Per-recipient allowlist UI (schema lands; UI v1.x).
- Background re-rationale on classifier upgrade.
- Calendar approvals (Phase 4).
- Outlook drafting/send (Phase 5).
- Design-partner gate (deferred for v1; self-as-exec persona).
- Local fine-tune for voice match (defer unless few-shot fails the bar — pragmatic v1.x).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| APPR-01 | All outbound communication requires explicit approval before transmission | Approval Queue state machine + tier-gate enforcement at send-time (see Architecture Patterns §State Machine + §Tier-Gate Enforcement Site) |
| APPR-03 | Approval card shows recipients, subject, full body preview, and any diff vs originating draft | `approval` table stores `body_original`/`body_edited`; UI card composes diff at render time (see §Approval Persistence Schema) |
| APPR-04 | User can approve/edit-then-approve/reject; rejections recorded for learning | State machine transitions + `rejection_reason` column + `LEARN-01` feed-forward (Phase 8) |
| APPR-05 | Queue survives app restart | Single `approval` SQLCipher table; writes BEFORE each state transition (`generating` row written before LLM call starts → crash leaves `interrupted` on launch); see §Crash Recovery Pattern |
| APPR-06 | Tier config schema (silent/explicit/always-confirm) per content class; v1 default always-confirm | `approval_tier` table keyed by `(content_class, override_severity_min)`; gate reads this; UI exposes only the always-confirm row in v1 |
| APPR-07 | Sensitivity classifier flags risky drafts for forced explicit approval regardless of tier | `severity == 'high'` OR `categories ∩ {financial,legal,hr}` ≠ ∅ → gate overrides tier → forced explicit. Belt + suspenders (gate-side + UI-side disable of approve button until user expands rationale) |
| LLM-02 | Redact identifiable content before frontier API; restore on response | Hybrid token-substitution + rehydrate (see §Redaction Pattern); reuse `redactAllPii` from `src/main/briefing/redact.ts` for the regex layer; new `tokenizeForFrontier` / `rehydrate` helpers for the per-draft substitution table |
| EMAIL-03 | Classify each new message by priority and surface "what needs the user" with rationale | New `triage` agent on top of existing `LLMRouter`; produces `{priority, signals, summary}`; persisted per `gmail_message.id` in a new `email_triage` table |
| EMAIL-04 | User can request a summary of any long email thread on demand | Thread summarization endpoint — input is `gmail_message` rows joined by `thread_id`; output `{summary, action_items, key_dates}` via `generateObject` |
| EMAIL-05 | System drafts replies in user voice; drafts enter Approval Queue | Voice-match spike → few-shot drafting agent → `approval` row in `pending` → `generating` → `ready` |
| EMAIL-06 | User can send approved drafts via Gmail; send-scope OAuth required and obtained | New `gmail.send` scope (separate consent flow extending existing `connectGoogle`); `users.messages.send` via googleapis; on success write `send_log` row + transition approval to `sent` |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Approval Queue persistence + state machine | Electron main (SQLCipher) | Renderer (read-only via IPC) | Single-writer DB; main is the only process that touches SQLCipher. |
| Approval Queue UI (cards, batch, diff, snooze) | Renderer (React/shadcn) | Main (IPC handlers) | UI lives in renderer; all reads/writes through `aria.*` bridge. |
| Sensitivity classifier (LLM-driven) | Electron main (existing `LLMRouter` + new classifier wrapper) | — | Local-only Ollama call by definition; never in renderer. |
| PII redaction + rehydration | Electron main (`src/main/briefing/redact.ts` + new `tokenize`/`rehydrate`) | — | Must stay co-located with classifier — token table can't cross process boundary. |
| Routing audit log | Electron main (`routing_log` table — already exists) | Renderer (read-only `/routing-log` view) | Existing `writeRoutingLog` helper. Add searchable view in renderer. |
| Email triage agent | Electron main (background, on gmail-sync completion) | — | Hooks `src/main/integrations/google/sync-gmail.ts` post-sync. |
| Thread summarization | Electron main (on-demand IPC handler) | Renderer (button + result modal) | One-off LLM call; routed through `p-queue`. |
| Voice-match draft generation | Electron main (drafting agent module) | Renderer (queue card → approval flow) | Drafting agent enqueues `approval` row, never sends. |
| Gmail send (OAuth + API call) | Electron main (`src/main/integrations/google/send.ts` — new) | Renderer (approve button → IPC) | Send happens main-side; renderer only triggers it. |
| Tier-gate enforcement | Electron main (single function called by send handler) | — | Critical control point — must be the last gate before `gmail.users.messages.send`. Renderer cannot bypass. |

**Tier integrity note:** The `tier-gate` must be enforced **on the main side** at the send IPC boundary. A determined renderer cannot bypass it because IPC handlers are the only path to `gmail.send`. APPR-01 verification = code grep showing the send adapter calls `assertApproved(approvalId)` as its first line, with no other call sites.

## Standard Stack

### Core (already in package.json — no install needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` | `^6.0.0` | `generateObject` for Zod-shaped LLM outputs | Already used in `src/main/briefing/generate.ts` for `BriefingSchema`; identical pattern for classifier/triage/draft/judge. [VERIFIED: package.json] |
| `zod` | `^4.0.0` | Schema definitions; AI SDK validates LLM output | Phase 1/2 pattern; Vercel AI SDK first-class support. [VERIFIED: package.json] |
| `ollama-ai-provider-v2` | `^3.0.0` | Local Ollama models via AI SDK 6 | NOT legacy `ollama-ai-provider` (incompatible with AI SDK 6 per Phase 1 RESEARCH). [VERIFIED: `src/main/llm/providers.ts` line 19] |
| `@ai-sdk/anthropic` | `^3.0.0` | Frontier provider (Claude) | Already pinned `claude-sonnet-4-5` in providers.ts; **recommended pairwise judge model**. [VERIFIED] |
| `better-sqlite3-multiple-ciphers` | `^12.0.0` | Approval/triage/send-log persistence | Same as all prior phases; SQLCipher encryption. [VERIFIED] |
| `googleapis` | `^144.0.0` | `gmail.users.messages.send` for EMAIL-06 | Phase 2 uses for read; same client extends to send with new scope. [VERIFIED] |
| `google-auth-library` | `^9.15.1` | OAuth2Client refresh; loopback PKCE flow | Already extended in `src/main/integrations/google/auth.ts`. [VERIFIED] |
| `p-queue` | `^9.0.0` | Serialize all Phase 3 LLM calls | Existing handle in `src/main/lifecycle/scheduler.ts` exposes `queue` (concurrency 1). All Phase 3 LLM calls MUST go through `scheduler.queue.add(...)`. [VERIFIED] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` | builtin | Token-substitution salts + draft IDs | Use `crypto.randomBytes(16).toString('hex')` for per-draft salt (see Redaction Pattern). [VERIFIED] |
| `react-router-dom` | `^6.0.0` | `/approvals` and `/routing-log` routes | Already wired in `src/renderer/app/routes.tsx`. [VERIFIED] |

### No new packages required

Phase 3 adds **zero new runtime dependencies** to package.json. Test-only additions may include a `playwright._electron` SIGKILL helper but no new npm package.

[VERIFIED: package.json read on 2026-05-17]

### Version verification skipped — versions are locked

All packages above are already installed at the version Phase 1/2 selected. No `npm view` step needed. Phase 3 must not bump them.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────────────────────┐
                    │              Renderer (React)                    │
                    │                                                  │
                    │   ┌─────────────┐    ┌─────────────────────┐    │
                    │   │ /approvals  │    │ Briefing inline     │    │
                    │   │ queue view  │    │ approvals preview   │    │
                    │   └─────┬───────┘    └──────────┬──────────┘    │
                    │         │                       │                │
                    │   ┌─────▼──────────────────────▼─────────┐     │
                    │   │ /routing-log  audit search view       │     │
                    │   └─────────────────────┬────────────────-┘     │
                    └─────────────────────────│────────────────────────┘
                                              │  window.aria.*  (IPC)
                    ┌─────────────────────────▼────────────────────────┐
                    │            Electron Main Process                 │
                    │                                                  │
                    │   ┌─────────────────────────────────────────┐   │
                    │   │  IPC layer (src/main/ipc/approvals.ts,  │   │
                    │   │   gmail-send.ts, triage.ts, classify.ts)│   │
                    │   └─────┬───────────────┬──────────────┬────┘   │
                    │         │               │              │        │
                    │  ┌──────▼────┐  ┌──────▼─────┐  ┌────▼──────┐  │
                    │  │ approval  │  │ tier-gate  │  │ classifier│  │
                    │  │ state mc  │──┤ enforce    │◄─┤ (Zod LLM) │  │
                    │  └──────┬────┘  └────────────┘  └─────┬─────┘  │
                    │         │                              │        │
                    │  ┌──────▼─────────────┐  ┌────────────▼─────┐  │
                    │  │ drafting agent     │  │ redact/tokenize/ │  │
                    │  │ (few-shot voice)   │──┤ rehydrate        │  │
                    │  └──────┬─────────────┘  └────────────┬─────┘  │
                    │         │                              │        │
                    │  ┌──────▼─────────────────────────────▼─────┐  │
                    │  │  scheduler.queue (p-queue, concurrency 1)│  │
                    │  │  ALL LLM calls go through here           │  │
                    │  └──────┬───────────────────────────┬───────┘  │
                    │         │                           │           │
                    │  ┌──────▼────────┐         ┌────────▼────────┐ │
                    │  │ LLMRouter     │         │ generateObject  │ │
                    │  │ (existing)    │         │ (AI SDK 6)      │ │
                    │  └──┬─────────┬──┘         └────────┬────────┘ │
                    │     │         │                     │           │
                    │  ┌──▼──┐ ┌────▼──────┐  ┌──────────▼────────┐ │
                    │  │Ollama│ │ Anthropic/│  │ writeRoutingLog +  │ │
                    │  │local │ │ OpenAI/   │  │ writeApprovalRow  │ │
                    │  └──────┘ │ Google    │  │ writeSendLog      │ │
                    │           └─┬─────────┘  └─────────┬──────────┘ │
                    │             │                       │            │
                    │  ┌──────────▼──────────┐           │            │
                    │  │ Gmail send adapter  │           │            │
                    │  │ (NEW scope: send)   │           │            │
                    │  └──────────┬──────────┘           │            │
                    │             │                      │            │
                    │             ▼                      ▼            │
                    │       Gmail API              SQLCipher DB       │
                    └─────────────────────────────────────────────────┘
                                  │
                                  ▼
                          gmail.users.messages.send
```

**Component responsibility (file map):**

| Capability | File (existing = reuse / new = create) |
|------------|----------------------------------------|
| Approval state machine | NEW: `src/main/approvals/state.ts` |
| Approval persistence | NEW: `src/main/approvals/persist.ts` (CRUD over `approval` table) |
| Tier-gate enforcement | NEW: `src/main/approvals/gate.ts` (single `assertApproved` function) |
| Sensitivity classifier (LLM) | NEW: `src/main/llm/sensitivityClassifier.ts` (wraps existing hard-rules) |
| PII tokenize/rehydrate | NEW: `src/main/llm/tokenize.ts` (extends `src/main/briefing/redact.ts`) |
| Email triage agent | NEW: `src/main/triage/email.ts` (hooks `sync-gmail.ts` post-sync) |
| Thread summarization | NEW: `src/main/triage/thread.ts` (on-demand) |
| Drafting agent | NEW: `src/main/drafting/email.ts` (few-shot from sent mail) |
| Voice-match eval harness | NEW: `src/main/drafting/eval/pairwise.ts` (run-once script + persisted result) |
| Gmail send adapter | NEW: `src/main/integrations/google/send.ts` |
| Gmail send scope extension | EDIT: `src/main/integrations/google/auth.ts` (add `gmail.send` scope to SCOPES.gmail or new SCOPES.gmail_send) |
| OAuth refresh-token storage | REUSE: `src/main/secrets/safeStorage.ts` (extend GoogleTokenKind union or store both scopes in same token entry — see §Send Scope Pattern) |
| Approval IPC channels | EDIT: `src/shared/ipc-contract.ts` + NEW: `src/main/ipc/approvals.ts`, `src/main/ipc/triage.ts`, `src/main/ipc/gmail-send.ts` |
| Approval UI | NEW: `src/renderer/features/approvals/ApprovalsScreen.tsx`, `ApprovalCard.tsx`, `BatchToolbar.tsx`, `EditDiff.tsx`, `SnoozeMenu.tsx` (replaces Phase 1 `ApprovalsPlaceholder.tsx`) |
| Routing-log search view | EDIT: `src/renderer/features/settings/RoutingLogPanel.tsx` → upgrade to full search; OR new dedicated `/routing-log` route |
| Migration | NEW: `006_approvals.sql` + embedded entry in `src/main/db/migrations/embedded.ts` |

### Recommended Project Structure

```
src/main/
├── approvals/              # NEW
│   ├── state.ts            # state machine + transition validation
│   ├── persist.ts          # SQLCipher CRUD
│   ├── gate.ts             # assertApproved — the ONLY way to authorize a send
│   └── tier.ts             # tier-config schema + lookup
├── llm/
│   ├── sensitivityClassifier.ts   # NEW — Zod schema + generateObject + bounded retry
│   ├── tokenize.ts                # NEW — per-draft token table + rehydrate
│   └── (existing: router.ts, classifier.ts (regex), routingLog.ts, providers.ts)
├── triage/
│   ├── email.ts            # NEW — priority + signals + summary per gmail_message
│   └── thread.ts           # NEW — on-demand thread summarization
├── drafting/
│   ├── email.ts            # NEW — few-shot drafter (post voice-match spike decision)
│   └── eval/
│       └── pairwise.ts     # NEW — run-once held-out eval harness
└── integrations/google/
    └── send.ts             # NEW — gmail.users.messages.send adapter
```

### Pattern 1: Approval State Machine (server-authoritative)

**What:** Approval rows transition through a typed state machine. Every transition writes a row update WITHIN a SQLCipher transaction, and the only "external effect" path (`ready → sent`) is gated by `assertApproved`.

**When to use:** Every outbound communication in v1 (Phase 3 email; Phase 4 calendar will reuse the same table).

**State machine:**
```
pending ─────────► generating ──┬─► ready ───► approved ──► sent
                                │                  │
                                │                  ├─► rejected
                                │                  ├─► snoozed (→ ready on snooze expiry)
                                └─► interrupted (crash recovery; user clicks regenerate → generating)
```

**Example:**
```typescript
// Source: pattern derived from Phase 2 src/main/briefing/persist.ts (idempotent upsert)
// New file: src/main/approvals/state.ts
export type ApprovalState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected'
  | 'snoozed'
  | 'interrupted'
  | 'sent';

const ALLOWED: Record<ApprovalState, ApprovalState[]> = {
  pending: ['generating'],
  generating: ['ready', 'interrupted'],
  ready: ['approved', 'rejected', 'snoozed'],
  approved: ['sent'],
  rejected: [],
  snoozed: ['ready'],          // snooze expiry timer
  interrupted: ['generating'], // user-clicked regenerate
  sent: [],
};

export function assertTransition(from: ApprovalState, to: ApprovalState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`invalid-transition:${from}->${to}`);
  }
}
```

### Pattern 2: Crash Recovery via Pre-Write

**What:** Before starting any LLM call that produces a draft, write the `generating` row to SQLCipher. If the process dies, on next launch a startup sweep finds rows in `generating` state and transitions them to `interrupted` (UI surfaces a regenerate button).

**Why:** Phase 1's `XCUT-02` invariant — drafts being generated across crashes never auto-transition to "sent."

**Example:**
```typescript
// Source: derived from Phase 1 vault unlock + Phase 2 briefing upsert patterns
// New: src/main/approvals/persist.ts startup hook
export function reapInterruptedOnStartup(db: Db): number {
  const result = db
    .prepare(`UPDATE approval SET state = 'interrupted', updated_at = ?
              WHERE state = 'generating'`)
    .run(new Date().toISOString());
  return result.changes;
}
// Called once from src/main/index.ts after db open, before any IPC handler registers.
```

### Pattern 3: Two-Stage Sensitivity Classifier (regex prefilter → Zod LLM)

**What:** Stage 1 — existing `classifySensitivity()` regex hard-rules (email, ssn, phone, currency, bearer, oauth-code) produces `matched: string[]`. Stage 2 — LLM call with Zod schema enriches with `{ categories, severity, confidence, rationale }`. If LLM fails after 2 retries, fall back to regex-derived synthetic categorization (`pii` category, severity=`high` if regex matched else `low`).

**Why:** Community benchmarks show 7-8B local models often return malformed JSON — bounded retry + regex fallback is the only way to keep the pipeline closed-loop.

**Example:**
```typescript
// Source: derived from src/main/briefing/generate.ts generateObject pattern (lines 487-493)
// New: src/main/llm/sensitivityClassifier.ts
import { z } from 'zod';
import { generateObject } from 'ai';
import { classifySensitivity } from './classifier'; // existing regex
import { getLocalModel } from './providers';

export const SensitivitySchema = z.object({
  categories: z.array(z.enum(['financial', 'legal', 'hr', 'pii', 'urgent', 'none'])).min(1),
  severity: z.enum(['low', 'med', 'high']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
});
export type SensitivityResult = z.infer<typeof SensitivitySchema>;
export const CLASSIFIER_VERSION = 'v1-llama3.1-8b-q4-2026-05';

export async function classify(
  text: string,
  queue: PQueue,
): Promise<SensitivityResult> {
  // Stage 1: regex prefilter — fast, deterministic
  const regex = classifySensitivity(text);

  // Stage 2: LLM with bounded retry
  const model = getLocalModel();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await queue.add(() =>
        generateObject({
          model,
          schema: SensitivitySchema,
          prompt: buildClassifierPrompt(text, regex.matched),
        }).then((r) => r.object),
      );
    } catch (err) { lastErr = err; }
  }

  // Stage 3: regex-fallback synthesis (never throw — fail closed to "sensitive")
  return {
    categories: regex.matched.length > 0 ? ['pii'] : ['none'],
    severity: regex.matched.length > 0 ? 'high' : 'low',
    confidence: 0.5,
    rationale: `LLM unavailable (${String(lastErr)}); regex-only: ${regex.matched.join(',')}`,
  };
}
```

### Pattern 4: PII Tokenize + Rehydrate (per-draft scoped)

**What:** Token table keyed by `(approvalId, tokenName)` → original value. Frontier prompt uses tokens; frontier response is scanned for tokens and substituted back. Token names are deterministic *within* a draft and isolated *across* drafts.

**Why locked decision in CONTEXT.md:** "tokens must be deterministic per-task and never leak across tasks."

**Example:**
```typescript
// Source: extends src/main/briefing/redact.ts pattern (NEW file)
// src/main/llm/tokenize.ts
export interface TokenTable {
  [token: string]: string; // e.g. 'PERSON_1' -> 'John Doe'
}
export interface TokenizedPrompt { prompt: string; table: TokenTable; }

// In-memory map keyed by approvalId; lifetime = single draft generation
const drafts = new Map<string, TokenTable>();

export function tokenizeForFrontier(approvalId: string, raw: string): TokenizedPrompt {
  const table: TokenTable = {};
  let counters = { PERSON: 0, EMAIL: 0, AMT: 0, ORG: 0, PHONE: 0 };
  let out = raw;
  // Apply DEFAULT_PII_PATTERNS from src/main/log/redact.ts — but instead of
  // replacing with a static token (<EMAIL>), assign sequential names per pattern
  // and store original in `table`. NER for PERSON/ORG is best-effort regex
  // (capitalized 2+ word sequences) — v1 conservative; v1.x can swap to a
  // local NER model.
  // … implementation walks each pattern …
  drafts.set(approvalId, table);
  return { prompt: out, table };
}

export function rehydrate(approvalId: string, frontierResponse: string): string {
  const table = drafts.get(approvalId);
  if (!table) throw new Error(`no-token-table:${approvalId}`);
  let out = frontierResponse;
  for (const [token, original] of Object.entries(table)) {
    out = out.replaceAll(token, original);
  }
  return out;
}

export function disposeDraftTable(approvalId: string): void {
  drafts.delete(approvalId);
}
```

**Cross-task isolation:** The `drafts` Map is process-local in main; each approval generation calls `tokenizeForFrontier(approvalId, …)` with a unique id (`crypto.randomUUID()`). Counters reset per call. Tokens never appear in another draft's table. The map is cleared on `disposeDraftTable` after send/reject. [Decision: in-memory only; if main process crashes mid-draft, the token table is lost — that's exactly correct because the approval row transitions to `interrupted` and must be re-generated.]

### Pattern 5: Send Scope OAuth (incremental consent)

**What:** Add `https://www.googleapis.com/auth/gmail.send` as a separate scope request. Two viable shapes:
- **Shape A — augment existing gmail token:** Re-run `connectGoogle('gmail')` with combined scopes `[gmail.readonly, gmail.send]`. Google's consent UI re-prompts for the additional scope. Requires editing `SCOPES.gmail` in `src/main/integrations/google/auth.ts`.
- **Shape B — separate token kind:** Add `gmail_send` to `GoogleTokenKind`. Cleaner separation but requires storing two refresh tokens.

**Research recommendation: Shape A.** Google issues a single refresh token covering all granted scopes; storing two is unnecessary complexity. The user sees ONE consent flow showing both scopes ("read your Gmail" + "send mail on your behalf"). The consent prompt copy (rendered in our explanation modal before opening the OAuth window) explains why each scope is needed — this addresses APPR-01 trust posture.

**Migration concern:** Existing Phase 2 users have a `gmail` token with `gmail.readonly` only. On Phase 3 upgrade, the Gmail status panel must show "Aria needs additional permission to send mail — re-connect Gmail" and re-run the consent flow. The old refresh token is discarded; the new one (with both scopes) replaces it via `setGoogleTokens({ kind: 'gmail', ... })`.

### Pattern 6: Voice-Match Held-Out Pairwise Judge (frontier judge)

**What:** Sample 50 sent emails stratified by (length: short/long) × (tone: formal/casual). For each, generate two reply candidates: (a) Aria's few-shot draft, (b) generic-LLM baseline (same frontier model, no few-shot examples). Pass both to a *third* LLM judge — **Claude Sonnet** — as a pairwise preference query: "Which reply better matches the user's voice as exemplified by [original sent emails]?" Judge returns `{winner: 'a'|'b'|'tie', catastrophic: boolean, reason: string}`.

**Why frontier judge (NOT local):** A local 7-8B judge is biased toward its own output style — if Aria's few-shot also uses Ollama, the judge prefers Ollama-style output regardless of voice match. Using Claude Sonnet as judge breaks this circularity. **Judge prompts contain user-sent-email content** — must route through the redaction layer (`tokenizeForFrontier`) and use the per-draft token table; this is a defensible exception because (a) the user explicitly opted into the eval, (b) only the held-out set is sent, (c) tokens are rehydrated locally before judge output is read.

**Example schema:**
```typescript
export const JudgeSchema = z.object({
  winner: z.enum(['a', 'b', 'tie']),
  catastrophic: z.boolean(),
  reason: z.string().max(200),
});
```

**Pass criteria (locked):** ≥65% win for Aria (`winner==='a'`) over the 50-item set, AND zero `catastrophic: true`.

### Pattern 7: Tier-Gate Enforcement Site

**What:** A single function `assertApproved(approvalId): void | throws` lives in `src/main/approvals/gate.ts`. The Gmail send adapter (`src/main/integrations/google/send.ts`) calls `assertApproved(approvalId)` as its first line. APPR-07's forced-explicit rule is enforced inside `assertApproved`: if `approval.severity === 'high'` OR `approval.categories ∩ {financial, legal, hr}` ≠ ∅, then `approval.state === 'approved'` is required even if tier is `silent`.

**Verification (success criterion 1 — bypass attempt):** A test calls `sendEmail({ approvalId })` directly against an unapproved row. `assertApproved` must throw. Test grep ensures no other call site invokes `gmail.users.messages.send` directly.

### Anti-Patterns to Avoid

- **Polymorphic state strings across modules.** Define `ApprovalState` once; import everywhere. Avoid duplicating the string literal `'approved'` in eight places.
- **Storing original PII in the LLM call's prompt for "context".** Tokenize ALL identifiable values before frontier; rehydrate AFTER response. No exceptions.
- **Snooze implemented in renderer.** Snooze expiry must fire from main-process `node-cron`; renderer can request a snooze but the timer must survive renderer lifecycle.
- **Calling `gmail.users.messages.send` from anywhere except `src/main/integrations/google/send.ts`.** Single chokepoint enables APPR-01 verification by grep.
- **Letting the briefing's "priority email" section call the new triage classifier on render.** Triage must run post-sync (main-side, queued, persisted), not on each render — otherwise user sees flicker + cost spikes.
- **Re-computing triage rationale on classifier upgrade silently.** Store classifier version; if version changes, mark rationale stale, don't auto-regenerate (CONTEXT.md decision).
- **Auto-retry of `interrupted` approvals on launch.** Locked decision: user must click regenerate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sending RFC 5322 email via Gmail | Custom MIME assembly | `googleapis` Gmail v1 — supports `raw` field as base64url-encoded RFC 2822 message; helpers in community | MIME edge cases (encoding, attachments, threading via `In-Reply-To`/`References`) bite you for months |
| JSON-shape enforcement on LLM output | Manual JSON.parse + ad-hoc validation | `generateObject` + Zod schema | AI SDK auto-retries malformed output; Zod gives typed result; pattern already in `src/main/briefing/generate.ts` |
| Diff display for edit-then-approve | Hand-rolled line diff | `diff-match-patch` (Google) or `jsdiff` — but **defer until UI cards exist**; first ship "edited vs original" two-column view | Real diff libs handle edge cases (multi-line wraps, whitespace); shadcn doesn't ship a diff component |
| PII regex patterns | New patterns | `DEFAULT_PII_PATTERNS` from `src/main/log/redact.ts` | Already covers email/ssn/phone/currency/bearer/oauth-code; classifier + briefing already reuse it; single source of truth |
| Refresh-token rotation | Custom retry on 401 | `OAuth2Client.on('tokens', …)` listener — already wired in `src/main/integrations/google/auth.ts` line 324 | Google rarely rotates but when it does, the listener re-persists transparently |
| Crash-recovery test harness | Manual process.kill + restart orchestration | Playwright `_electron` test with `app.evaluate(() => process.exit(137))` mid-draft, then re-launch and assert `state === 'interrupted'` | Playwright `_electron` already used in Phase 2 e2e — extend, don't write a new runner |
| Email parsing for triage signals | Bespoke header parser | Reuse `gmail_message` row fields already populated by Phase 2 (`subject`, `from_addr`, `snippet`, `label_ids`, `is_unread`, `is_important`, `received_at`) | Phase 2 already extracted these — triage agent reads SQLCipher, doesn't call Gmail |
| Long-thread fetch for summarization | Per-message API calls | Query `gmail_message WHERE thread_id = ? ORDER BY received_at ASC` | Phase 2 ingests full thread; triage uses stored rows |
| VIP detection | New contact CRM | v1: `from_addr` heuristic (user's most-replied senders over last 30 days); query `gmail_message` history | Phase 6 will introduce contacts; v1 ships approximation; documented limitation |

**Key insight:** Phase 3 is mostly **wiring on top of Phase 1/2 infrastructure**. Almost every "do I build this?" question for Phase 3 has an answer in `src/main/*` already. The new code is ~6 main modules (`approvals/`, `triage/`, `drafting/`, `llm/sensitivityClassifier.ts`, `llm/tokenize.ts`, `integrations/google/send.ts`) + 1 renderer feature folder + 1 migration. Anything beyond that should be challenged at plan-check.

## Approval Persistence Schema (Recommended)

```sql
-- migration 006_approvals.sql
CREATE TABLE approval (
  id TEXT PRIMARY KEY,                       -- crypto.randomUUID()
  kind TEXT NOT NULL CHECK (kind IN ('email_send')),  -- Phase 4 adds 'calendar_change'
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','approved','rejected','snoozed','interrupted','sent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- email_send payload (NULL when kind != 'email_send'; Phase 4 adds calendar columns)
  source_message_id TEXT,                    -- gmail_message.id we are replying to
  recipients_json TEXT,                      -- JSON ['a@b.com', ...]
  subject TEXT,
  body_original TEXT,                        -- LLM-generated draft (rehydrated)
  body_edited TEXT,                          -- user-edited body (NULL until edit-approved)

  -- classifier output (frozen at ready time)
  classifier_version TEXT,
  categories_json TEXT,                      -- ['financial', 'pii']
  severity TEXT CHECK (severity IN ('low','med','high')),
  confidence REAL,
  classifier_rationale TEXT,
  routed TEXT CHECK (routed IN ('local','frontier','hybrid')),

  -- triage rationale (when this approval is for replying to a triaged email)
  triage_signals_json TEXT,                  -- ['from-vip','deadline-mentioned']
  triage_summary TEXT,

  -- terminal states
  rejection_reason TEXT,
  snooze_until TEXT,
  sent_at TEXT,
  send_log_id INTEGER                        -- FK to send_log.id when sent
);
CREATE INDEX idx_approval_state ON approval(state);
CREATE INDEX idx_approval_kind_state ON approval(kind, state);
CREATE INDEX idx_approval_updated_at ON approval(updated_at DESC);

CREATE TABLE approval_tier (
  content_class TEXT PRIMARY KEY,            -- 'email_send_general', 'email_send_high_severity', ...
  tier TEXT NOT NULL CHECK (tier IN ('silent','explicit','always-confirm'))
);
-- Seed: ('email_send_general','always-confirm') — v1 only-editable row

CREATE TABLE send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  provider TEXT NOT NULL,                    -- 'gmail'
  provider_msg_id TEXT,                      -- Gmail's returned message id
  recipients_json TEXT NOT NULL,
  subject TEXT,
  ok INTEGER NOT NULL CHECK (ok IN (0,1)),
  error TEXT,
  FOREIGN KEY (approval_id) REFERENCES approval(id)
);

CREATE TABLE email_triage (
  message_id TEXT PRIMARY KEY,               -- gmail_message.id
  classifier_version TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent','needs-you','fyi','archive')),
  signals_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  ts TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES gmail_message(id)
);
CREATE INDEX idx_email_triage_priority ON email_triage(priority, ts DESC);
```

**Decision rationale (Claude's discretion):**
- **Single polymorphic `approval` table** chosen over per-kind tables because (a) Phase 4 adds calendar approvals using the same state machine, (b) the queue UI must render heterogeneous items in one list, (c) snooze/rejection columns are shared. Nullable email-specific columns are acceptable — sparse rows are cheap in SQLite.
- **`triage` is a separate table** keyed by `gmail_message.id` because not every triage produces a draft/approval. EMAIL-03 fires on every new message; EMAIL-05 only fires when user requests a reply.

## Runtime State Inventory

Phase 3 is greenfield code additions on top of Phase 2; no rename/refactor/migration. **Section omitted (not applicable).**

## Common Pitfalls

### Pitfall 1: `generateObject` over Ollama returns malformed JSON
**What goes wrong:** 7-8B models occasionally produce truncated JSON or extra prose around the JSON block; `generateObject` throws.
**Why it happens:** Smaller models lack the consistency of frontier models on schema following.
**How to avoid:** Bounded retry (2 attempts) + regex-fallback synthesis (see Pattern 3). Existing briefing engine has same risk and degrades gracefully (`degradedPayload` path in `generate.ts` lines 544-575).
**Warning signs:** `routing_log` rows with `ok=0` and `reason` containing `generateObject-failed`.

### Pitfall 2: Token leakage across drafts
**What goes wrong:** Two drafts in flight; draft B's frontier response contains `PERSON_1` and rehydration uses draft A's table → wrong name substituted.
**Why it happens:** Tokens are not draft-scoped.
**How to avoid:** Per-approval-id token table (Pattern 4). `disposeDraftTable(approvalId)` on terminal state.
**Warning signs:** Unit test: two concurrent `tokenizeForFrontier` calls produce overlapping token names with different originals — must be acceptable because tables are keyed by approvalId.

### Pitfall 3: Renderer bypasses the approval gate
**What goes wrong:** Future feature calls `gmail.users.messages.send` directly without `assertApproved`.
**Why it happens:** Phase 3's tier-gate enforcement assumes a single send call site.
**How to avoid:** Single chokepoint file `src/main/integrations/google/send.ts`; first line is `assertApproved(approvalId)`; lint/grep test asserts no other call site exists.
**Warning signs:** Code grep finds `gmail.users.messages.send` outside the gate.

### Pitfall 4: OAuth incremental consent doesn't grant send scope
**What goes wrong:** User clicks "Connect Gmail with send" but Google returns a token with only `gmail.readonly` because they previously granted that.
**Why it happens:** Without `prompt=consent`, Google may skip the consent UI and reuse prior grant.
**How to avoid:** Phase 2's `buildAuthorizationUrl` already uses `prompt=consent` (`src/main/integrations/google/auth.ts` line 105) — preserve this.
**Warning signs:** Post-consent token request to `gmail.users.messages.send` returns 403.

### Pitfall 5: Crash mid-draft leaves stale `generating` row
**What goes wrong:** Main process crashes between `INSERT … state='generating'` and the LLM call completing. On relaunch, the row sits in `generating` forever; user sees a stuck card.
**Why it happens:** No startup sweep.
**How to avoid:** `reapInterruptedOnStartup(db)` (Pattern 2) runs once at DB connect, before any IPC handler registers. UI surfaces interrupted state with a regenerate button.
**Warning signs:** `approval` rows with `state='generating'` and `updated_at` more than ~10 minutes old.

### Pitfall 6: APPR-07 forced-explicit override silently bypassed
**What goes wrong:** User has set tier to `silent` for a content class; classifier flags `severity=high`; if the gate doesn't override, draft sends without confirmation. Trust violation.
**Why it happens:** Tier check happens in one place; severity override happens in another; they drift.
**How to avoid:** Both checks in `assertApproved`. Belt + suspenders: UI also disables the "approve silently" path when severity=high.
**Warning signs:** Test scenario — set tier=silent, generate draft flagged high; without explicit click, send must throw.

### Pitfall 7: Voice-match judge bias (local judge picking local-flavored output)
**What goes wrong:** Eval reports 80% Aria-voice wins but real-world drafts feel off.
**Why it happens:** Local judge model has its own style preference correlated with the few-shot output.
**How to avoid:** Frontier judge (Claude Sonnet via existing Anthropic provider). Eval inputs go through `tokenize` first.
**Warning signs:** Spike report shows local judge and frontier judge disagree by >20 points.

### Pitfall 8: Phase 2's "no-important-label" empty state pollutes Phase 3 triage
**What goes wrong:** Phase 2 briefing showed Gmail's `IMPORTANT` label as priority. Phase 3 triage replaces this — but if you forget to remove the Phase 2 query, briefing's email section diverges from `/approvals` queue.
**Why it happens:** `src/main/briefing/generate.ts` line 184 still uses `is_important=1`.
**How to avoid:** Wave-N task: rewrite `gatherEmailCandidates` to JOIN `email_triage` and select `priority IN ('urgent','needs-you')`. Update Phase 2 placeholder copy.
**Warning signs:** Briefing shows "no priority email" while `/approvals` shows 5 items.

### Pitfall 9: Gmail send returns 403 because CASA verification is in-flight
**What goes wrong:** Dev build hits production OAuth client, send call returns 403 with "App not verified."
**Why it happens:** CASA Tier 2 verification for restricted scopes (`gmail.send` is sensitive but Google's verification still applies for restricted-scope apps; queue is 2-8 weeks). [CITED: deepstrike.io 2025-CASA blog + discuss.google.dev forum]
**How to avoid:** Dev builds keep test-mode + "verification-pending banner" (CONTEXT decision). Production credentials gated behind CASA approval (already kicked off Phase 1 per `01-03-CASA-INTAKE.md`). Plan task: explicitly include a "verification-pending" UI state in `IntegrationsSection.tsx`.
**Warning signs:** First send attempt against unverified app returns 403 or hits an "unverified-app" consent screen.

### Pitfall 10: PII regex matches inside legitimate email body (e.g. user replying to a finance question)
**What goes wrong:** User wants to reply "The $5,000 transfer cleared yesterday" — currency regex tokenizes `$5,000` to `AMT_1` and the frontier never sees the actual amount, producing a tone-deaf reply.
**Why it happens:** Aggressive tokenization is exactly the design intent; but voice match suffers.
**How to avoid:** This is a *design* tradeoff. v1 ships aggressive (preserves privacy invariant). UI shows the user "Aria's reply was drafted with [3] redacted values restored — review before sending." Document the limitation.
**Warning signs:** Drafts contain awkward token-shaped placeholders post-rehydration (rehydration failure) — unit test must catch.

## Code Examples

### Example 1: `assertApproved` — the single gate

```typescript
// Source: pattern — Phase 1 src/main/llm/router.ts NoLlmProviderError style
// New: src/main/approvals/gate.ts
import type { Db } from '../db/connect';

export class ApprovalGateError extends Error {
  readonly code: 'not-found' | 'not-approved' | 'forced-explicit-missing';
  constructor(code: ApprovalGateError['code'], message: string) {
    super(message);
    this.name = 'ApprovalGateError';
    this.code = code;
  }
}

const FORCED_CATEGORIES = new Set(['financial', 'legal', 'hr']);

export function assertApproved(db: Db, approvalId: string): void {
  const row = db.prepare(
    `SELECT state, severity, categories_json FROM approval WHERE id = ?`
  ).get(approvalId) as { state: string; severity: string | null; categories_json: string | null } | undefined;

  if (!row) {
    throw new ApprovalGateError('not-found', `approval not found: ${approvalId}`);
  }
  if (row.state !== 'approved') {
    throw new ApprovalGateError('not-approved', `approval ${approvalId} state=${row.state}, must be 'approved'`);
  }
  // APPR-07: forced-explicit override
  const cats: string[] = row.categories_json ? JSON.parse(row.categories_json) : [];
  const isForced = row.severity === 'high' || cats.some((c) => FORCED_CATEGORIES.has(c));
  if (isForced) {
    // 'approved' transition itself must have happened via explicit user click;
    // additional invariant: ensure no silent-tier path produced this row.
    // (Implementation: when transitioning to 'approved', record the path:
    //  approval.approval_path TEXT NOT NULL CHECK IN ('explicit','silent'))
    const path = db.prepare(`SELECT approval_path FROM approval WHERE id = ?`)
      .get(approvalId) as { approval_path: string };
    if (path?.approval_path !== 'explicit') {
      throw new ApprovalGateError(
        'forced-explicit-missing',
        `severity=high/forced-category requires explicit approval; got path=${path?.approval_path}`,
      );
    }
  }
}
```

### Example 2: Gmail send adapter

```typescript
// Source: extends Phase 2 src/main/integrations/google/auth.ts + gmail.ts patterns
// New: src/main/integrations/google/send.ts
import { google } from 'googleapis';
import { getOAuth2Client } from './auth';
import { assertApproved } from '../../approvals/gate';
import { writeSendLog } from '../../approvals/persist';
import type { Db } from '../../db/connect';

export interface SendResult { ok: true; providerMsgId: string }

export async function sendApprovedEmail(
  db: Db,
  approvalId: string,
): Promise<SendResult> {
  // GATE — FIRST LINE. APPR-01 / APPR-07.
  assertApproved(db, approvalId);

  const row = db.prepare(
    `SELECT recipients_json, subject, COALESCE(body_edited, body_original) AS body,
            source_message_id
     FROM approval WHERE id = ?`
  ).get(approvalId) as { recipients_json: string; subject: string; body: string; source_message_id: string | null };

  const oauth = getOAuth2Client('gmail');
  if (!oauth) throw new Error('gmail-not-connected');
  const gmail = google.gmail({ version: 'v1', auth: oauth });

  const recipients: string[] = JSON.parse(row.recipients_json);
  const raw = buildRfc2822({
    to: recipients,
    subject: row.subject,
    body: row.body,
    inReplyTo: row.source_message_id,
  });

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    const providerMsgId = String(res.data.id ?? '');
    writeSendLog(db, { approvalId, ok: 1, providerMsgId, recipients });
    db.prepare(`UPDATE approval SET state='sent', sent_at=?, updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), new Date().toISOString(), approvalId);
    return { ok: true, providerMsgId };
  } catch (err) {
    writeSendLog(db, { approvalId, ok: 0, error: String(err), recipients });
    throw err;
  }
}

function buildRfc2822(args: { to: string[]; subject: string; body: string; inReplyTo: string | null }): string {
  const lines = [
    `To: ${args.to.join(', ')}`,
    `Subject: ${args.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (args.inReplyTo) {
    lines.push(`In-Reply-To: ${args.inReplyTo}`);
    lines.push(`References: ${args.inReplyTo}`);
  }
  lines.push('', args.body);
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}
```

### Example 3: Crash-recovery e2e test sketch

```typescript
// Source: pattern — Phase 2 Playwright _electron tests
// New: tests/e2e/approval-crash-recovery.spec.ts
import { _electron as electron, test, expect } from '@playwright/test';

test('mid-generation crash → row surfaces as interrupted on relaunch', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] });
  await app.evaluate(async ({ ipcMain }) => {
    // trigger draft generation via IPC stub that sleeps before LLM call returns
    return new Promise((resolve) => setTimeout(resolve, 200));
  });
  // Hard kill main (SIGKILL equivalent on Win = exit code 137 via process.exit)
  await app.evaluate(() => process.exit(137));

  const app2 = await electron.launch({ args: ['out/main/index.js'] });
  const win = await app2.firstWindow();
  await win.goto('aria://approvals');
  await expect(win.getByText('Interrupted — regenerate?')).toBeVisible();
  await app2.close();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled JSON parsing of LLM output | `generateObject` + Zod with auto-retry | AI SDK 5+ (2025-07) | Pattern already adopted in Phase 2; extend to classifier/triage/draft. [CITED: ai-sdk.dev docs] |
| `ollama-ai-provider` (legacy) | `ollama-ai-provider-v2` | AI SDK 6 release | Already pinned in package.json. Plan must NOT introduce legacy. [VERIFIED: 01-RESEARCH] |
| Full local fine-tune for voice match | Few-shot from sent mail + frontier judge | Practical solo-dev constraint | Recommendation: defer fine-tune to v1.x; few-shot is the v1 ship. [CITED: collabnix.com fine-tune guide — feasible but heavy] |
| Local LLM as judge | Frontier (Claude Sonnet) as judge | Bias awareness | Avoid judge-bias circularity. |

**Deprecated/outdated:**
- `ollama-ai-provider` (the v1 package) — replaced by `ollama-ai-provider-v2`.
- `keytar` for secrets — already replaced by `safeStorage` in Phase 1.
- Per-message Gmail API fetches for thread summarization — Phase 2 already ingests full threads into SQLCipher; query the DB.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `gmail.send` is the correct scope name (sensitive, not restricted) | Pattern 5 + Pitfall 9 | LOW — Google search results confirm. If wrong, OAuth fails at consent time and is caught early. |
| A2 | Frontier judge (Claude Sonnet) does not have prohibitive cost for 50 pairwise comparisons | Pattern 6 | LOW — ~$1-3 total for the eval run; one-time spend. |
| A3 | `crypto.randomUUID()` is available in Electron 41 main process | Pattern 4 | LOW — Node 20 LTS includes it; Electron 41 bundles Node ≥20. |
| A4 | Llama 3.1 8B Q4_K_M is reliable enough for the classifier with 2 retries + regex fallback | Pattern 3 + Common Pitfalls | MEDIUM — community reports mixed; mitigation is the regex fallback. If unreliable in practice, swap to Qwen 2.5 7B (also pre-pulled by many users) or bump to a 13-14B model for the classifier only. |
| A5 | Polymorphic `approval` table scales to Phase 4 calendar approvals without schema rework | Approval Persistence Schema | LOW — sparse-column SQLite is well-suited; documented in Phase 4 will append columns. |
| A6 | The user's CASA Tier 2 review (kicked off Phase 1 per `01-03-CASA-INTAKE.md`) covers `gmail.send` | Pitfall 9 | MEDIUM — Phase 1 intake should confirm the scope list submitted included `gmail.send`. **PLANNER ACTION: verify by re-reading `01-03-CASA-INTAKE.md` before sequencing the send plan.** |
| A7 | Approval table can be populated from main-side only (no renderer mutations) | Architecture | LOW — established Phase 2 pattern. |
| A8 | Few-shot voice-match can clear the 65% bar without local fine-tune for the self-as-exec persona | Voice-Match section | MEDIUM — empirical; the spike measures this. If it fails, ship "beta voice" label (CONTEXT-locked). |
| A9 | `gmail.users.messages.send` returning success means the email is delivered | Send adapter | LOW — Gmail queues server-side; success = accepted, not delivered. v1 acceptable; v1.x can add a `sent → delivered` follow-up via thread polling. |

**Planner: assumptions A4 and A6 are MEDIUM risk — flag for `/gsd-discuss-phase` reconfirmation if not already addressed.**

## Open Questions (RESOLVED)

1. **Token table approach for NER (PERSON_N, ORG_N) without a local NER model** — RESOLVED: skip PERSON/ORG in v1; document as known limitation. If classifier-flagged-sensitive content includes a person name, route LOCAL (no frontier call) per CONTEXT-locked rule. The forced-local routing for HR/legal/financial-at-severity-≥med already covers the realistic risky case.
   - What we know: regex covers email/phone/ssn/currency/bearer; PERSON and ORG are harder.
   - What's unclear: v1 ships regex-only (capitalized 2-word sequences as a heuristic)? Or skips PERSON/ORG tokens in v1 entirely?
   - Recommendation: skip PERSON/ORG in v1; document as known limitation. If classifier-flagged-sensitive content includes a person name, route LOCAL (no frontier call) per CONTEXT-locked rule. The forced-local routing for HR/legal/financial-at-severity-≥med already covers the realistic risky case.

2. **Snooze expiry — node-cron poll vs setTimeout?** — RESOLVED: minute-resolution node-cron sweep that UPDATEs approval state from snoozed to ready when snooze_until has elapsed — survives restart, no per-row timer.
   - What we know: node-cron is already running.
   - What's unclear: per-snooze setTimeout (memory) vs minute-resolution node-cron sweep.
   - Recommendation: minute-resolution node-cron sweep that `UPDATE approval SET state='ready' WHERE state='snoozed' AND snooze_until <= ?` — survives restart, no per-row timer.

3. **Triage update on Gmail label change** — RESOLVED: v1 — no. Document. v1.x feature.
   - What we know: triage is stored once (CONTEXT-locked).
   - What's unclear: if a user marks a message Important in Gmail post-triage, should we re-triage?
   - Recommendation: v1 — no. Document. v1.x feature.

4. **`/routing-log` view — extend Phase 1's panel or new route?** — RESOLVED: upgrade in place; add filter inputs (date range, route, source, category) above the existing list. Match Phase 1 D-07 evolution intent.
   - What we know: `RoutingLogPanel.tsx` exists as a minimal "last N" view under Settings → Diagnostics (D-07).
   - What's unclear: upgrade-in-place vs new dedicated route.
   - Recommendation: upgrade in place; add filter inputs (date range, route, source, category) above the existing list. Match Phase 1 D-07 evolution intent.

5. **Should the email triage agent run on every poll, or only at briefing-time?** — RESOLVED: triage on every sync delta, but only for newly-inserted rows (no re-triage of existing). p-queue serializes; cost-bounded ≤1 LLM call per new message.
   - What we know: Gmail sync runs every 5 minutes; briefing runs once per day.
   - What's unclear: 5-min triage = more LLM calls; daily = stale priority for hourly-checking users.
   - Recommendation: triage on every sync delta, but **only for newly-inserted rows** (no re-triage of existing). p-queue serializes; cost-bounded ≤1 LLM call per new message.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Ollama daemon (localhost:11434) | Classifier, triage, drafting | Required at runtime | — | Existing Phase 1 banner: "Ollama unreachable — Aria local mode unavailable." Classifier falls back to regex-only synthesis. |
| Llama 3.1 8B Q4_K_M | Local classifier/triage/draft | Required (user-pull) | `llama3.1:8b-instruct-q4_K_M` | Settings → Ollama → model picker already exists; user can pick another local model. |
| Anthropic API key (or OpenAI/Google) | Frontier path + judge model in voice-match eval | Recommended | — | If no frontier key: voice-match eval cannot run with frontier judge → spike must use local-judge with bias warning, OR defer eval until key configured. Drafting/triage still work in LOCAL-only mode (per LLM-05). |
| Google CASA Tier 2 verification | Production gmail.send | In-flight (Phase 1 kicked off) | — | Dev: verification-pending banner; production: block release until letter of assessment. |
| Playwright browser binaries | E2E tests including crash-recovery | Required for CI | — | None — must install. |

**Missing dependencies with no fallback:** None for plan-time (all are runtime concerns the plan addresses).

**Missing dependencies with fallback:** All listed above have fallbacks documented.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (unit/integration) + Playwright 1.60 `_electron` (e2e) |
| Config file | `vitest.config.ts`, `playwright.config.ts` (already exist; verify in Wave 0) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| APPR-01 | Cannot send without approved state | unit | `vitest run tests/unit/approvals/gate.test.ts` | ❌ Wave 0 |
| APPR-01 | No code path calls `gmail.users.messages.send` except send.ts | static grep | custom: `tests/static/single-send-call-site.test.ts` | ❌ Wave 0 |
| APPR-03 | Card payload includes recipients/subject/body/diff | unit | `vitest run tests/unit/approvals/persist.test.ts` | ❌ Wave 0 |
| APPR-04 | Approve / edit-then-approve / reject transitions | unit | `vitest run tests/unit/approvals/state.test.ts` | ❌ Wave 0 |
| APPR-05 | Queue survives restart; interrupted on crash | e2e | `playwright test tests/e2e/approval-crash-recovery.spec.ts` | ❌ Wave 0 |
| APPR-05 | Startup sweep transitions generating→interrupted | unit | `vitest run tests/unit/approvals/persist.test.ts::reapInterrupted` | ❌ Wave 0 |
| APPR-06 | Tier config schema enforced; always-confirm is default | unit | `vitest run tests/unit/approvals/tier.test.ts` | ❌ Wave 0 |
| APPR-07 | severity:high OR forced-category overrides tier | unit | `vitest run tests/unit/approvals/gate.test.ts::forced-explicit` | ❌ Wave 0 |
| LLM-02 | PII tokens substituted before frontier, rehydrated after | unit | `vitest run tests/unit/llm/tokenize.test.ts` | ❌ Wave 0 |
| LLM-02 | Token tables isolated across concurrent drafts | unit | `vitest run tests/unit/llm/tokenize.test.ts::isolation` | ❌ Wave 0 |
| LLM-02 | HR/legal/financial≥med routes LOCAL only | integration | `vitest run tests/integration/sensitivity-routing.test.ts` | ❌ Wave 0 |
| EMAIL-03 | Triage row written on new gmail_message insert | integration | `vitest run tests/integration/triage-on-sync.test.ts` | ❌ Wave 0 |
| EMAIL-03 | Triage priority + signals + summary present | unit | `vitest run tests/unit/triage/email.test.ts` | ❌ Wave 0 |
| EMAIL-04 | Thread summary generated for >N-message thread | unit + e2e | `vitest run tests/unit/triage/thread.test.ts` | ❌ Wave 0 |
| EMAIL-05 | Drafting agent produces approval row in `ready` | integration | `vitest run tests/integration/drafting-to-approval.test.ts` | ❌ Wave 0 |
| EMAIL-06 | Send adapter calls `assertApproved` first; on success writes send_log | unit | `vitest run tests/unit/integrations/google/send.test.ts` | ❌ Wave 0 |
| EMAIL-06 | E2E approve → send → SENT folder (mocked Gmail API) | e2e | `playwright test tests/e2e/approve-and-send.spec.ts` | ❌ Wave 0 |
| Voice-match | Spike runs and writes eval report | one-shot script | `npx tsx scripts/voice-match-eval.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (vitest unit only — fast)
- **Per wave merge:** `npm run test` (unit + playwright e2e)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

All new — Phase 3 introduces all listed test files. Wave 0 task must:

- [ ] Add `tests/unit/approvals/{gate,state,persist,tier}.test.ts`
- [ ] Add `tests/unit/llm/{tokenize,sensitivityClassifier}.test.ts`
- [ ] Add `tests/unit/triage/{email,thread}.test.ts`
- [ ] Add `tests/unit/integrations/google/send.test.ts`
- [ ] Add `tests/integration/{sensitivity-routing,triage-on-sync,drafting-to-approval}.test.ts`
- [ ] Add `tests/e2e/{approval-crash-recovery,approve-and-send}.spec.ts`
- [ ] Add `tests/static/single-send-call-site.test.ts` — greps `src/main/**` and asserts only `src/main/integrations/google/send.ts` references `users.messages.send`
- [ ] Add `scripts/voice-match-eval.ts` — one-shot eval runner
- [ ] Add MSW mocks for `gmail.users.messages.send` so e2e doesn't hit real Gmail

Framework install: none — vitest + playwright already in `package.json`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Google OAuth 2.0 loopback + PKCE — already implemented in Phase 2. Send-scope extension reuses same primitives. |
| V3 Session Management | no | Single-user desktop app; no server sessions. |
| V4 Access Control | yes | `assertApproved` gate is the access-control kernel for outbound sends. APPR-07 forced-explicit is the privilege-escalation guard. |
| V5 Input Validation | yes | Zod schemas (`SensitivitySchema`, draft schema, judge schema); recipient-list validation (`isEmail`) before send. |
| V6 Cryptography | yes | SQLCipher whole-DB; `safeStorage` for refresh tokens; PII tokens via `crypto.randomBytes` (high entropy). **Never hand-roll.** |
| V7 Error Handling | yes | Typed error classes (`ApprovalGateError`, `TokenInvalidError`, `OAuthStateMismatchError`) — pattern from Phase 2 `src/main/integrations/google/auth.ts`. |
| V8 Data Protection | yes | PII never reaches frontier in plaintext (tokenize+rehydrate); HR/legal/financial≥med forced LOCAL; refresh tokens never logged. |
| V12 API Communications | yes | TLS via googleapis (mandatory); Anthropic/OpenAI/Google providers use HTTPS by default in AI SDK 6. |
| V13 Configuration | yes | OAuth client ID/secret via `.env.local` (dev) or build-time embed (production) — already established Phase 2 pattern. |

### Known Threat Patterns for Aria Phase 3

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer-injected send call without approval | Elevation of Privilege | Single chokepoint + `assertApproved` first line + static grep test |
| PII leak via frontier prompt | Information Disclosure | Tokenize+rehydrate + forced-local routing for HR/legal/financial≥med (CONTEXT-locked) |
| Token-table cross-contamination | Information Disclosure | Per-approvalId scoped tables; dispose on terminal state |
| Refresh-token leak via SQLCipher row | Information Disclosure | safeStorage only; `T-02-01-01` invariant — assert at code-review time |
| Snooze-bypass (user changes system clock) | Tampering | Acceptable v1 — user owns the machine; documented. v1.x could use monotonic clock. |
| Classifier prompt-injection (email body contains "ignore previous instructions") | Tampering | LLM is downstream of regex; even if classifier returns `severity=none`, the regex hard-rules still match PII patterns and force LOCAL. APPR-07 is data-driven (categories + severity) not prompt-driven. |
| `interrupted` approval auto-retried by buggy code | Repudiation / unintended action | Locked: no auto-retry. UI requires explicit click. Test asserts no code path auto-transitions `interrupted → generating`. |
| Forced-explicit override bypassed by direct DB write | Elevation of Privilege | DB is SQLCipher-encrypted; only main process holds key. Renderer cannot write directly. |
| OAuth consent screen phishing (malicious app mimics Aria) | Spoofing | Phase 8 release prep: code-signed binaries (XCUT-05). Out of Phase 3 scope. |
| Gmail send to wrong recipients (typo or hallucination) | Tampering / Loss | Approve-card preview shows recipients verbatim; user-eye is the gate. Forced-explicit for severity≥high. |

## Sources

### Primary (HIGH confidence)
- `C:/Users/HomePC/Documents/GitHub/Aria/.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send/03-CONTEXT.md` — Locked decisions (read in full)
- `C:/Users/HomePC/Documents/GitHub/Aria/.planning/REQUIREMENTS.md` — APPR-01..07, LLM-02, EMAIL-03..06
- `C:/Users/HomePC/Documents/GitHub/Aria/.planning/ROADMAP.md` — Phase 3 success criteria
- `C:/Users/HomePC/Documents/GitHub/Aria/CLAUDE.md` — Locked tech stack
- `C:/Users/HomePC/Documents/GitHub/Aria/.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md` — Phase 2 carry-forward
- `C:/Users/HomePC/Documents/GitHub/Aria/.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 foundation patterns
- Aria codebase (verified files): `src/main/llm/{router,classifier,routingLog,providers}.ts`, `src/main/briefing/{generate,redact}.ts`, `src/main/integrations/google/{auth,gmail}.ts`, `src/main/secrets/safeStorage.ts`, `src/main/lifecycle/scheduler.ts`, `src/main/db/migrations/embedded.ts`, `src/shared/ipc-contract.ts`, `package.json`

### Secondary (MEDIUM confidence)
- [AI SDK Core: generateObject](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object) — official Vercel docs
- [ai-sdk-ollama npm package](https://www.npmjs.com/package/ai-sdk-ollama) — provider notes including cascade-repair for malformed JSON
- [Structured Outputs with Vercel's AI SDK (aihero.dev)](https://www.aihero.dev/structured-outputs-with-vercel-ai-sdk) — generateObject patterns
- [Restricted scope verification — Google Identity docs](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) — CASA + scope policy
- [Google CASA 2025: Tiers, Costs & Compliance Explained (deepstrike.io)](https://deepstrike.io/blog/google-casa-security-assessment-2025) — CASA Tier 2 timeline (4-8 weeks) and cost
- [Llama 3.1 8B vs Qwen 2.5 7B benchmark (rankllms.com / galaxy.ai)](https://rankllms.com/compare/llama-3-1-8b-vs-qwen-2-5-7b/) — structured-output adherence comparison
- [Best Local LLMs for Function Calling (insiderllm.com)](https://insiderllm.com/guides/function-calling-local-llms/) — Llama 3.1 favored for strict JSON
- [Modelfile Reference — Ollama](https://docs.ollama.com/modelfile) — LoRA adapter integration syntax
- [Complete Guide: Fine-Tuning Llama 3.2 with Ollama and LoRA (medium)](https://medium.com/@sausi/complete-guide-fine-tuning-llama-3-2-locally-with-ollama-and-lora-be7eb05314ff) — solo-dev fine-tune feasibility (heavy; recommend defer)

### Tertiary (LOW confidence — flagged for validation)
- Specific CASA Tier 2 turnaround for Aria's submission (Phase 1 intake doc claims in-flight; depends on Google queue — verify with Phase 1 `01-03-CASA-INTAKE.md` status note)
- Exact `generateObject` adherence rate for Llama 3.1 8B Q4_K_M on Aria's classifier prompt (empirical — measure during Wave 0 fixture)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in `package.json`, all patterns already used in Phase 2.
- Architecture: HIGH — direct extension of Phase 1/2 single-main-writer + IPC + LLMRouter shape.
- Sensitivity classifier reliability: MEDIUM — mitigated by 2-stage prefilter + retry + regex fallback.
- Voice-match outcome: MEDIUM — empirical; spike is the measurement.
- Gmail send-scope CASA: MEDIUM — depends on Phase 1 intake status (planner to verify).
- Crash recovery test harness: HIGH — Playwright `_electron` + main-process `process.exit(137)`.

**Research date:** 2026-05-17
**Valid until:** 2026-06-17 (30 days; AI SDK 6 + Ollama provider versions stable)
