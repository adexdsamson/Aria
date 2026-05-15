# Phase 1: Foundation - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship an installable Electron 33 + Vite + React + TypeScript desktop app with: encrypted SQLite store (better-sqlite3-multiple-ciphers + SQLCipher), OS-keychain secrets via `safeStorage`, recovery passphrase onboarding, encrypted backup/restore, Ollama detection, multi-provider frontier API key configuration, and an LLM router skeleton (Vercel AI SDK 5) with a hard-rules sensitivity classifier and routing log — proven end-to-end by a hello-briefing stub.

Scope is bounded by ROADMAP.md Phase 1 and requirements FOUND-01..07, LLM-01, LLM-03..05. No Gmail/Calendar ingest in this phase. No packaging/notarization (deferred to Phase 8).

</domain>

<decisions>
## Implementation Decisions

### Recovery Passphrase & Onboarding
- **D-01:** Hybrid passphrase model. A system-generated 12-word BIP39 mnemonic is the canonical recovery key (used to derive the SQLCipher master key). The user also sets a shorter daily-unlock password that decrypts a local vault containing the mnemonic / derived key material.
- **D-02:** Daily-unlock password is prompted **at launch only**. Aria stays unlocked for the duration of the session; no re-prompt after OS lock/sleep. The OS lock screen is treated as the security boundary while running.
- **D-03:** Mnemonic confirmation during onboarding: re-enter 3 words from random positions (e.g., #4, #7, #11). Not full re-entry, not a simple checkbox.
- **D-04:** Backup/restore scope: encrypted `.ariabackup` file portable across machines. Mnemonic alone is sufficient to decrypt on a new machine. **OAuth tokens and frontier API keys are NOT included in the backup** — they live in OS keychain and the user re-authenticates on restore.

### LLM Router & Sensitivity Classifier (v1, hard-rules)
- **D-05:** Routing rule = **source-based default + pattern overrides**. Default route is determined by the prompt's `source` tag (user-data-derived content → LOCAL; generic prompts → FRONTIER). A pattern/regex layer can force LOCAL on a generic prompt that still looks PII-shaped (emails, phone numbers, $$ amounts, SSN-like, contact names).
- **D-06:** Every LLM call must pass through the router and be tagged with a `source` (e.g., `user-email`, `user-calendar`, `user-transcript`, `generic`). The router writes a routing-decision row for every call to a SQLCipher table: timestamp, route (LOCAL/FRONTIER), reason, source tag, prompt hash.
- **D-07:** Routing-log UI in Phase 1 is **minimal**: a read-only "last N entries" list inside Settings → Diagnostics. Full filtering/search panel deferred to Phase 3 with the sensitivity-router upgrade.
- **D-08:** Fail-closed semantics (LLM-04) are non-negotiable: if `source` is unset or classifier is uncertain → route LOCAL.
- **D-09:** Frontier providers wired in Phase 1: **Anthropic + OpenAI + Google**, one active at a time. Settings UI lets the user pick the active provider and enter that provider's key. All three use AI SDK 5 adapters.
- **D-10:** No-key behavior: onboarding asks once for a frontier API key. If skipped, app enters **LOCAL-only mode** — all routing forces LOCAL, and a non-blocking banner reads "Frontier disabled — add an API key in Settings." Hello-briefing stub must work LOCAL-only against Ollama.

### App Shell & Hello-Briefing Stub
- **D-11:** App shape = **single main window with left side nav**. Sections present in Phase 1: Briefing, Approvals (placeholder), Routing Log (under Settings > Diagnostics in Phase 1), Settings. No tray app, no global hotkey in v1.
- **D-12:** Briefing surface in Phase 1 is intentionally bare — a plain "Aria is alive" / status screen. The end-to-end LLM round-trip lives in **Settings → Diagnostics** as an input box + "Ask Aria" that returns the model's reply and the routing decision (route + reason). This is the dogfood loop until Phase 2 fills the briefing.
- **D-13:** Visual direction = **shadcn/ui + Tailwind + a thin custom theme**. Define a small token set up front: neutral palette, one accent color, defined type scale, radii, spacing. System light/dark. No full design-system work; just enough so later phases don't drift.
- **D-14:** Platform priority = **Windows-first** (the dev's machine). macOS path verified at Phase 8 release prep. Linux not in v1. Dev build must run cleanly on Windows 11; native deps (better-sqlite3-multiple-ciphers, sqlite-vec) must build there.

### Cross-Cutting (carried from CLAUDE.md / ROADMAP.md)
- **D-15:** Google CASA security review must be kicked off during Phase 1 (multi-week lead time for `gmail.send` used in Phase 3). Treat as a parallel non-engineering task tracked in this phase's plan.
- **D-16:** Data directory lives under Electron `app.getPath('userData')`. Document the exact path used. PII redaction is applied at the log sink (pino) from day 1.

### Claude's Discretion
- Migration framework choice (e.g., umzug-style vs hand-rolled SQL files) — pick what fits better-sqlite3 best.
- Specific shadcn components scaffolded vs added lazily.
- p-queue concurrency defaults for the router; node-cron schedule for the (eventually-Phase-2) daily-briefing job — scaffold the hooks, leave the cadence open.
- PII redaction allowlist/regex shape at the pino sink — sensible default, revisit when real logs exist.
- Whether the routing log "last N" is 50 or 100 entries.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Scope
- `.planning/PROJECT.md` — Project vision, persona, trust posture, key decisions
- `.planning/REQUIREMENTS.md` §FOUND-01..07, §LLM-01, §LLM-03..05 — Locked requirements for Phase 1
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — Goal, success criteria, plan estimates, cross-cutting notes
- `CLAUDE.md` — Locked tech stack, version targets, rejected alternatives

### Stack Research (already produced)
- `.planning/research/` — Existing project-level research outputs (summary + stack/architecture/pitfalls) feeding Phase 1

### External — to be confirmed during planning
- AI SDK 5 docs (Anthropic, OpenAI, Google, ollama-ai-provider) — `generateText` / `generateObject` patterns
- BIP39 word list + reference implementations for the mnemonic generator
- SQLCipher key-derivation guidance for better-sqlite3-multiple-ciphers
- Electron `safeStorage` docs + Windows DPAPI fallback notes
- Google CASA self-assessment intake (Phase 1 starts the multi-week clock)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield repo. Only `.planning/` docs and `CLAUDE.md` exist at start of Phase 1.

### Established Patterns
- None to honor yet. Phase 1 establishes the conventions; later phases inherit them.

### Integration Points
- Settings UI (built in this phase) is where every later phase plugs in: integration auth (Phase 2/5), approval-tier config (Phase 3), scheduling rules (Phase 4), Todoist token (Phase 6), preference reset (Phase 8).
- LLM router (built in this phase) is the single chokepoint every agent in Phases 2–8 routes through. Its interface (input: prompt + source tag; output: response + routing-decision row) is the contract.
- SQLCipher DB is the only persistence store. Migration framework chosen here is the one every later phase uses.

</code_context>

<specifics>
## Specific Ideas

- BIP39 mnemonic onboarding mirrors crypto-wallet UX (familiar to executive users via password managers like 1Password's secret key).
- Routing log "minimal UI" approach is modeled on Settings > Privacy & Security diagnostic panels — visible enough to demonstrate trust, not so prominent it dominates the v1 surface.
- LOCAL-only mode banner phrasing should match the Aria voice: factual and non-anxious ("Frontier disabled — add an API key in Settings"), not scary ("AI features disabled!").

</specifics>

<deferred>
## Deferred Ideas

- **Tray app + global hotkey** — useful for an always-on assistant; revisit after Phase 2 once the briefing surface has real content worth peeking at.
- **Re-prompt for unlock after OS lock/sleep** — stronger security stance; consider as an opt-in setting in a later phase once user feedback exists.
- **Full routing-log UI** (filtering, search, export) — folded into the Phase 3 sensitivity-router upgrade, where it becomes a real trust-building surface.
- **Mock briefing with placeholder rows** — Phase 2 will populate the briefing for real, so investing in mock data now is wasted effort.
- **macOS / Linux dev builds in CI** — Phase 8 release prep handles macOS signing/notarization. Linux not in v1.
- **OAuth tokens / API keys included in encrypted backup** — convenience win, but secrets leaving the OS keychain is a posture change; revisit only if real-world restore friction proves it necessary.

</deferred>

---

*Phase: 1-Foundation*
*Context gathered: 2026-05-15*
