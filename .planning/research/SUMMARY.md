# Research Summary

**Project:** Aria - local-first desktop AI executive assistant
**Synthesized:** 2026-05-14
**Inputs:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

## Key Findings

### Stack
- **Electron 33 over Tauri** for solo-dev velocity - Aria value lives in Node-native libs (googleapis, msal-node, better-sqlite3, node-cron, docx); Tauri forces Rust depth and its Stronghold plugin is being deprecated.
- **React 18 + Vite 5 + TS 5 + Tailwind 3.4 + shadcn/ui** for UI (largest LLM training corpus = fastest Claude Code pairing).
- **Ollama + ollama-js** for local LLM sidecar (NOT node-llama-cpp in v1). Default models: Llama 3.1 8B or Qwen 2.5 7B for sensitivity routing; nomic-embed-text v1.5 for embeddings.
- **Vercel AI SDK 5** unifies Anthropic / OpenAI / Google / Ollama behind one routing API. generateObject + Zod for sensitivity classifier and action-item extractor.
- **better-sqlite3 + sqlite-vec + SQLCipher** as the single encrypted store (metadata + embeddings together; one key, one file).
- **Electron safeStorage** for secrets (keytar is dead).
- **electron-builder + electron-updater** for packaging; signed updates with pre-migration DB backup.

### Table Stakes (every competitor has these; Aria must too)
- OAuth into Gmail + Outlook + Google Cal + Outlook Cal
- Daily briefing before work-start with top 3-5 priorities and rationale
- AI draft replies in user voice; thread summarization
- Priority/urgency triage of inbound mail
- Natural-language scheduling, conflict detection, scheduling rules engine
- Meeting transcript -> action items -> task system push
- Conversational Q&A with citations
- Weekly recap (editable, exportable PDF/DOCX)
- Preference learning over time
- Approval-before-send on all outbound

### Differentiators (where Aria wins alone)
- Data never leaves the machine except as scoped LLM prompts
- PII/sensitive content routed to local model, never to API (hybrid LLM routing)
- Sensitivity classifier holds risky drafts for explicit review
- Insights from user OWN data (calendar load, response times, themes)
- Voice/tone learning from actual sent mail
- "Why this mattered" rationale on every triage decision
- One desktop pane across Gmail + Outlook + GCal + Outlook Cal
- Runs offline (local model paths)
- No subscription required for core (hybrid means floor works with zero API keys)
- Audit log of every Aria action visible in weekly recap

### Anti-Features (cut entirely)
- Autopilot send / auto-reschedule without approval
- Bot-in-the-meeting transcription, cloud-stored transcripts
- Multi-party scheduling negotiation, team/shared workspaces
- CRM, BI, voice, health, IoT (already in PROJECT.md cuts)
- General chatbot framing, plugin marketplace, real-time push notifications
- AI Employee autonomous agents (autonomous = unsupervised = trust violation)

### Architecture (build order)
- **Tier 0 Foundation:** Local Store + SQLCipher + safeStorage + IPC contract + LLM Router skeleton with hard-rules classifier
- **Tier 1 First vertical slice:** Gmail read-only adapter -> sync layer -> briefing agent MVP (today calendar + unread priorities) -> UI (chat + briefing + settings)
- **Tier 2 Trust-critical:** Approval Queue persisted entity -> Email draft agent (queue, never auto-send) -> sensitivity classifier model + redaction layer -> Google Calendar smart-scheduling
- **Tier 3 Compound value:** RAG layer (after MVP integrations - chunking is data-shape-driven) -> Outlook + MS Cal parity -> Meeting transcript ingestion + action extraction -> Task adapters (Todoist first) -> Weekly recap -> Preference learning loop

Critical boundary rules: UI never talks to integrations directly; agents never write to integrations directly (everything through Approval Queue); LLM Router is the only place that decides local vs frontier.

### Existential Pitfalls (the four that kill the product)
1. **Approval-UX collapse** - tier the gates, never undifferentiated; address in Phase 3.
2. **Sensitivity-classifier silent failure** - layered defence (regex + classifier + redaction + audit log + fail-closed); Phase 4.
3. **OAuth scope procurement (Google CASA)** - kick off in Phase 1; weeks of lead time.
4. **Solo-dev scope sprawl** - defend the PROJECT.md cuts at every phase boundary.

## Confidence Assessment

| Area | Level | Reason |
|---|---|---|
| Stack choices | HIGH | Verified library versions, multiple sources, fits constraints |
| Table-stakes feature set | HIGH | Multiple competitor analyses converge |
| Differentiator analysis | HIGH | Architecturally verifiable (no cloud product can match) |
| Architecture patterns | MEDIUM-HIGH | Standard patterns; some Aria-specifics (sensitivity router) need spike |
| Pitfall identification | MEDIUM-HIGH | Domain-specific, with phase mapping |
| Local LLM model choice | MEDIUM | 8B vs 7B both viable; benchmark on design-partner hardware |
| Tauri vs Electron call | HIGH | Stack research is firm: Electron for this constraint set |
| OAuth CASA timeline | LOW (re-verify) | Current 2026 timing not confirmed |

## Watch Out For

- One PII leak to a frontier API destroys the local-first claim. Defence-in-depth in the LLM router from day one.
- Solo dev cannot maintain voice / health / call / VoIP / CRM / BI / IoT. Defend the cuts.
- Approval fatigue is a real failure mode. Design the tier system before shipping drafting.
- RAG chunking strategy must be data-driven; spike on real content before locking.
- macOS notarization + Windows SmartScreen warm-up + antivirus false positives are real Phase 8 cost.
- Recruit a real SMB-exec user before Phase 3 (Approval Queue / drafting). Building to a persona for too long is a known solo-dev failure.

## Phase Implications for Roadmapper

The 7 capability clusters in v1 map to roughly the following phase shape (the roadmapper should validate / refine, but this is the architecturally implied order):

1. **Foundation** - Electron + Vite + React scaffold, SQLCipher, safeStorage, IPC, AI SDK 5 with Anthropic + Ollama providers, LLM router skeleton, recovery-phrase + backup/restore. Also Phase 1 kicks off Google CASA procurement.
2. **Gmail ingest + Briefing MVP** - First vertical slice. Useful demo to show a real user.
3. **Approval Queue + Email triage with rationale + Email drafting** - Trust-critical layer. Requires sensitivity classifier upgrade.
4. **Sensitivity classifier upgrade + LLM router maturation** - Promote router from hard-rules to classifier-driven; redaction layer; PII regression tests.
5. **Google Calendar smart-scheduling + rules engine** - NL commands, conflict detection, focus blocks.
6. **Outlook parity (email + calendar) via Graph + MSAL**.
7. **Meeting transcript ingest + action-item extraction + Todoist push**.
8. **RAG Q&A** (last, since needs email + calendar + meeting indexed).
9. **Weekly recap + insights from own data + briefing personalization**.
10. **Packaging, signing, notarization, autoupdate, release prep**.

Solo dev + open timeline + 10 phases at "Standard" granularity means each phase is a small number of plans (3-5). The roadmapper may collapse some adjacent phases - that's the right call to make based on the granularity preference in config.json (standard).
