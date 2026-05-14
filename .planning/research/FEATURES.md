# Feature Research

**Domain:** Local-first desktop AI personal assistant / chief-of-staff for SMB executives
**Researched:** 2026-05-14
**Confidence:** MEDIUM-HIGH

## Executive Summary

The executive AI assistant market in 2025-2026 has converged on a feature set - daily briefing, inbox triage, AI scheduling, meeting capture with action items, conversational search over user data. Every serious competitor (Copilot 365, Gemini Workspace, Superhuman, Shortwave, Motion, Reclaim, Granola, Fathom, Read.ai, Lindy) ships some subset. **Feature parity is table stakes; differentiation lives elsewhere.**

Two structural differentiators carry Aria:
1. **Local-first / hybrid LLM as a hard privacy guarantee.** No cloud competitor can offer "your inbox never leaves your machine."
2. **Approval-gated everything.** The dominant complaint about AI email assistants in 2025 is loss of trust from autopilot mistakes. Aria converts the industry biggest failure mode into a positioning advantage.

## Table Stakes (users expect)

- OAuth into Gmail AND Outlook
- OAuth into Google Calendar AND Outlook Calendar
- Daily briefing before work-start (under 5 min to read), top 3-5 priorities WITH rationale
- AI draft replies in user voice (matches sent-mail style)
- Thread summarization on long emails
- Priority/urgency classification of inbound mail
- Natural-language scheduling ("move my 3pm to Thursday")
- Conflict detection + resolution proposals before write
- User-defined scheduling rules (no meetings after 4pm, focus blocks, buffers)
- Multi-calendar unified view
- Meeting transcript -> action items with owners
- Structured meeting summary (decisions / actions / follow-ups)
- Push action items to task system
- Conversational Q&A across user own data with citations
- Weekly recap (auto-generated, editable, exportable PDF/DOCX)
- Preference learning over time
- Approval-before-send on all outbound

## Differentiators (Aria wins here)

- Data never leaves machine except as scoped LLM prompts
- PII/sensitive content routed to local model, never to API
- Sensitivity classifier holds risky drafts for explicit review
- Daily briefing + insights pulls local data + external news in one pane
- Insights: trends from user OWN data (calendar load, response times, themes)
- Voice/tone learning from actual sent mail
- "Why this mattered" rationale on every triage decision
- One desktop pane across Gmail+Outlook+GCal+OutlookCal
- Runs offline (local model paths)
- No subscription required for core (hybrid means floor works with no API keys)
- Configurable approval-gate granularity (always-confirm vs per-recipient allowlist)
- Recap auto-includes "what Aria did this week" log

## Anti-Features (deliberately NOT building)

- Autopilot send (any auto-reply without confirmation) - one bad send destroys reputation
- Auto-rescheduling existing meetings without approval - surprise calendar moves embarrass execs
- Bot-in-the-meeting transcription - execs hate bots; consent issues. Granola model (device audio / paste-in) is correct
- Cloud-stored transcripts / recordings - breaks local-first on highest-stakes data
- Multi-party scheduling negotiation - separate product surface; v2
- Team / shared workspace - Aria is single-user by design
- CRM/Salesforce/HubSpot - already cut in PROJECT.md
- BI tool integration (Tableau, Power BI) - already cut
- General-purpose chatbot framing - dilutes positioning
- Plugin / skill marketplace - solo dev cannot maintain
- Real-time inbox push notifications - trains users to react instantly, opposite of "Aria handled it by Friday"
- Auto-categorizing into 10+ folders - over-segmentation erodes trust
- AI-generated KPI dashboards - SMB data not structured enough
- Voice interface (STT/TTS) - deferred in PROJECT.md
- Health pillar - HIPAA-adjacent, already cut
- Web search / browsing tool - feature creep
- "AI Employee" autonomous agents - autonomous = unsupervised = trust violation by definition

## Feature Dependencies

```
Foundation: OAuth + token storage + Local data store
  -> Ingestion: Email, Calendar, Meeting transcript
  -> Hybrid LLM Router: Sensitivity classifier (local), Local path, Frontier path with redaction
  -> Core capabilities: triage, drafting (needs sent-mail history), smart-scheduling (needs rules engine), meeting->actions, voice/tone learning
  -> Derived capabilities: RAG Q&A (needs ALL of email+cal+meeting ingested), Daily briefing (needs email+cal+insights+news), Insights (>= 2 weeks data), Weekly recap (week of Aria actions logged)
  -> Cross-cutting: Approval gate (wraps every outbound; ships with foundation), Preference learning, Action audit log
```

Critical dependency notes:
- RAG Q&A depends on email + calendar + meeting ingest shipping first
- Insights depend on >= 2 weeks of historical data; ship ingestion early
- Email drafting voice-match depends on read access to sent folder
- Approval gate must ship BEFORE any write capability (gate first, drafting second)
- Sensitivity classifier is the load-bearing prerequisite for the hybrid routing differentiator - if weak, the differentiator is theater
- Task-system push is per-integration cost; pick Todoist first (simplest API, broadest SMB-exec usage)
- External news in briefing is independent - use as early "feels alive" win
- Meeting capture conflicts with "no cloud transcription": v1 = paste/upload (user controls); v2 = local Whisper

## MVP Definition (v1 launch surface)

- [ ] OAuth Gmail + Outlook (read-only first) + Google/Outlook Calendar
- [ ] Local SQLite + encrypted store + incremental ingest
- [ ] Approval gate + action audit log
- [ ] Sensitivity classifier (local model)
- [ ] Hybrid LLM router (local for sensitive, frontier for general)
- [ ] Daily briefing v1: priorities + calendar preview + news
- [ ] Email triage: priority bucketing with "why this" rationale
- [ ] Thread summarization on demand
- [ ] Email drafting in user voice (review-before-send)
- [ ] Calendar natural-language commands ("move my 3pm")
- [ ] Calendar conflict detection + proposed resolutions
- [ ] User scheduling rules engine (focus blocks, buffers, no-meeting windows)
- [ ] Meeting transcript paste/upload -> action items + summary
- [ ] Task-system push: Todoist only for v1
- [ ] RAG Q&A over email + calendar + meeting notes with citations
- [ ] Weekly recap (auto, editable, exportable PDF/DOCX)
- [ ] Preference learning (passive)

## Add After Validation (v1.x)

- Live meeting capture (local Whisper)
- Asana + Jira task-system push
- Per-recipient approval allowlists
- Briefing personalization knobs
- More news source curation
- Cross-account email composition

## Competitor Snapshot (where Aria stands alone)

Bottom four rows of the matrix:
- **Data stays local**: No (every competitor) / **Yes** (Aria)
- **Hybrid local/cloud LLM**: No (every competitor) / **Yes** (Aria)
- **Approval-gated by default**: Partial (most) / **Yes, hard requirement** (Aria)
- **Runs offline**: No (most) / **Partial** (Aria, local model paths)

## Open Questions

- Which local model class actually performs well enough for sensitivity classification on consumer hardware? (Spike in Phase 2)
- Does voice-matched drafting via few-shot from sent mail work, or does it need local fine-tuning?
- Todoist vs Asana for v1 task system? Depends on design partner stack.
- Briefing "external news" scope - guardrails needed to prevent creep.

## Sources

- Shortwave vs Superhuman (Baytech, Zapier)
- Motion vs Reclaim vs Clockwise (Genesys Growth)
- Best AI Notetakers 2025 (Read.ai)
- Granola vs Fireflies vs Fathom vs Otter (Granola)
- Microsoft Copilot 365 vs Gemini Enterprise (Microsoft, Baytech)
- Lindy AI Executive Assistant (Lindy)
- Adaptive Daily Executive Briefings
- "ALL Email AI assistants suck" (limitededitionjonathan substack)
