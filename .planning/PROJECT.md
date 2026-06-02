# Aria

## What This Is

Aria is a local-first desktop AI personal assistant for executives and busy professionals - the always-on chief-of-staff layer over their calendar, inbox, tasks, and meetings. It earns trust by producing a daily briefing that surfaces what matters today, then takes on triage, drafting, scheduling, and meeting-capture work under user oversight. Built for a generic SMB-executive persona (founders, partners, senior leaders) running it on their own machine.

## Core Value

A trustworthy daily briefing + insights layer is the wedge; chief-of-staff actions (email, calendar, meeting follow-through) are the value compound. If Aria tells the user what matters every morning and has handled the rest by Friday, it has earned its place.

## Current State

**v1.0 — ✅ SHIPPED 2026-06-02** (Phases 1–13, incl. 08.1; ~416 commits over ~19 days). The full v1 vision landed: encrypted local-first foundation + hybrid LLM router, daily briefing, approval-gated email/calendar/meeting/task actions, Outlook parity, RAG + Knowledge Folders, insights + weekly recap, subscription/trial, editorial UI, web research, background tray, and open-source release prep. Milestone audit = `tech_debt` (integration INTACT, no blockers). See [MILESTONES.md](./MILESTONES.md) and [milestones/v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md).

**Carried tech debt:** Phase 9 design walkthrough, Phase 2/8 live/release verification, macOS tray UAT, dark-mode `--aria-gray-*` gap, typecheck-on-WIP.

## Current Milestone: v2.0 — Voice Interface

**Goal:** Aria becomes voice-driven — a full conversational, talk-to-Aria assistant over the existing briefing / triage / scheduling / ask / drafting surfaces.

**Target features:**
- **Hybrid audio (local-first default, cloud opt-in):** on-device STT (Whisper large-v3-turbo, MIT) + on-device TTS (Kokoro-82M / Chatterbox-Turbo) by default; consent-gated cloud opt-in for max quality. Mirrors the existing hybrid-LLM-routing pattern.
- **Full conversational duplex** via a local cascading pipeline (STT → LLM → TTS) with turn-taking + barge-in.
- **Both activations:** push-to-talk + opt-in always-listening wake-word.
- **Voice drives real work:** spoken briefing/answer playback + voice-driven triage/scheduling/ask/drafting; approval-gated actions get a voice-confirm flow (the `assertApproved` chokepoint still holds).
- **Consent & disclosure UX** before any audio leaves the machine on the cloud opt-in path.

**Deferred to v2.1+:** multi-party meeting coordination · advanced reports + predictive analytics · extensibility/plugins. (Phase numbering continues from 14.)

**Model research (2026):** STT — Whisper large-v3-turbo (MIT, on-device via whisper.cpp) is the local default; NVIDIA Canary/Parakeet are faster/heavier (GPU). TTS — Kokoro-82M (#1 TTS Arena, permissive, tiny) + Chatterbox-Turbo (beat ElevenLabs 65% in blind tests, sub-200ms); avoid XTTS-v2 (CPML non-commercial). True single-model duplex (Moshi) needs A100-class GPU → use a local cascading pipeline instead.

## Requirements

### Validated

✓ **All v1.0 capability clusters shipped (2026-06-02)** — daily briefing & insights, email triage/drafting/send, calendar smart-scheduling (Google + Outlook), meeting capture → Todoist, RAG Q&A + Knowledge Folders, weekly recap (DOCX/PDF), preference learning, hybrid LLM routing, and the approval chokepoint. Full per-requirement outcomes archived in [milestones/v1.0-REQUIREMENTS.md](./milestones/v1.0-REQUIREMENTS.md). Live-usage validation (dogfood, design-partner) carries forward.

### Active

**Daily Briefing & Insights (core):**
- [ ] Generate a daily briefing pulling from calendar, email, tasks, and external news
- [ ] Surface trends/insights derived from the user own data (calendar load, response times, recurring themes)
- [ ] Deliver briefing on a schedule the user controls (morning by default)

**Email Triage & Drafting:**
- [ ] Connect Gmail and Outlook inboxes (read access)
- [ ] Classify incoming email by priority/urgency, surface what needs the user
- [ ] Draft replies that match the user voice; user approves every send
- [ ] Summarize long threads on demand

**Calendar Smart-Scheduling:**
- [ ] Connect Google Calendar and Outlook Calendar
- [ ] Unified multi-calendar view across work and personal
- [ ] Find optimal slots given user constraints (focus blocks, buffers, time zones)
- [ ] Detect and flag conflicts before they are scheduled; propose resolutions
- [ ] Honor user-defined rules (no meetings after 4pm, etc.)

**Meeting Capture to Action Items:**
- [ ] Accept meeting transcripts (paste/upload first; live capture later)
- [ ] Extract action items, owners, and commitments from transcripts/notes
- [ ] Push actions into the user task system (Asana / Jira / Todoist)
- [ ] Generate concise meeting summaries

**Conversational Q and A over User Data:**
- [ ] RAG index over the user emails, meeting notes, and calendar events
- [ ] Natural-language queries return cited answers

**Weekly Recap Report:**
- [ ] Auto-generated weekly summary: meetings held, actions closed/open, wins, what is coming
- [ ] User can edit before finalizing; Aria learns preferences over time
- [ ] Exportable as document (PDF / DOCX)

**Cross-cutting:**
- [ ] User approval required for any outbound communication and any significant calendar change
- [ ] Sensitivity classifier holds drafts that look risky for explicit confirmation
- [ ] Learned preferences (voice, scheduling rules, tone) refine over time
- [ ] Hybrid LLM routing: local model for PII/sensitive content, frontier API for general reasoning

### Out of Scope

**v2 - defer until v1 validates:**
- Voice interface (STT/TTS, voice commands) - huge engineering; text/chat first proves the product
- Personal Health pillar (device integration, vitals, alerts, medication, lab parsing) - regulatory complexity (HIPAA-adjacent); not worth the risk before product fit
- Full executive Reports beyond the weekly recap (monthly/quarterly, KPI dashboards, budget proposals)
- Predictive analytics beyond simple trends from user own data (no business forecasting, no industry-wide models)
- Multi-party meeting coordination (back-and-forth scheduling negotiation with external attendees)
- Special-date tracking / personal relationship reminders
- Administrator role, RBAC, enterprise policy enforcement
- Developer SDK / plugin marketplace

**Cut - explicitly not building:**
- Call handling / VoIP / Twilio integration - too much eng for a solo dev; meeting capture covers most of the value
- IoT / smart-home / security cameras / computer vision - wrong domain for an SMB-exec assistant
- CRM integrations (Salesforce, HubSpot) - enterprise complexity, not where MVP value lives
- BI tool integrations (Tableau, Power BI) - same reasoning; defer until enterprise pivot

## Context

- **Origin doc:** Project Idea.docx - ambitious 6-pillar ABD assistant spec; this PROJECT.md is the disciplined v1 cut.
- **Builder:** Solo developer pairing with Claude Code; timeline is open-ended (ship-when-ready, not deadline-driven).
- **First users:** Generic SMB executive persona. No named design partner yet - finding one early is a project risk worth surfacing.
- **Trust posture:** Aria does nothing irreversible without explicit user approval. The product reputation depends on the user never being surprised by something Aria sent or moved.
- **Privacy posture:** User data lives on the user machine. Sensitive content (PII, health-adjacent, financials) routes to a local model; general reasoning goes to a frontier API. This is the local-first guarantee.

## Constraints

- **Tech stack:** TypeScript / Node throughout. Desktop shell = Tauri (preferred for size + Rust IPC) or Electron (faster to staff). React or similar for UI.
- **Deployment:** Local-first desktop app. Data never leaves the user machine except as scoped LLM prompts to frontier APIs (with PII pre-routed to a local model).
- **LLM strategy:** Frontier APIs (OpenAI / Anthropic / Google) for reasoning; local small model (Llama 3 / Qwen class, via Ollama or llama.cpp) for sensitive routing.
- **Team:** Solo dev + Claude. Phases must be small enough that one person can complete them in a session.
- **Timeline:** Open-ended. Bias toward correctness and learning over shipping speed; but every phase ends in something usable.
- **Approval gating:** All outbound communication, all material calendar changes, all sensitive-flagged content require explicit user confirmation.
- **Compliance:** No HIPAA, no PCI in v1 (Health and direct financial actions are out of scope). Standard OAuth and least-privilege scopes for Google/Microsoft.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local-first desktop app (Tauri/Electron + TS/Node) over SaaS web | Privacy is the differentiator vs Copilot/Gemini; execs will not hand inbox + calendar to multi-tenant SaaS | Pending |
| Hybrid LLM: local for sensitive, frontier API for reasoning | Pure-API leaks PII; pure-local cannot reason well enough; hybrid threads the needle | Pending |
| Core value = daily briefing + insights | Creates a daily habit on day one; rest compounds from there | Pending |
| v1 spans 7 capability clusters | User chose full vision scope; open-ended timeline permits it | Revisit - large for solo dev; may descope at plan-checker |
| Defer voice, health, call/VoIP, CRM, BI, IoT to v2 or cut | Solo dev cannot ship all 6 ABD pillars in v1 without compromising any | Pending |
| User-in-the-loop for every send and material calendar change | Trust beats automation. One surprising send destroys the product reputation | Pending |
| No named design partner at start | Acceptable risk; user will dogfood and recruit during development | Revisit - recruit a real SMB-exec user before Phase 3 |
| v2.0 voice audio = hybrid (local-first default + consent-gated cloud opt-in) | 2026 research: local models (Whisper large-v3-turbo MIT; Kokoro-82M / Chatterbox-Turbo) now match cloud quality, so local-first is preserved as default rather than pivoting to cloud. Cloud opt-in mirrors existing hybrid-LLM routing. | v2.0 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via /gsd-transition):
1. Requirements invalidated? Move to Out of Scope with reason.
2. Requirements validated? Move to Validated with phase reference.
3. New requirements emerged? Add to Active.
4. Decisions to log? Add to Key Decisions.
5. "What This Is" still accurate? Update if drifted.

**After each milestone** (via /gsd-complete-milestone):
1. Full review of all sections.
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state.

---
*Last updated: 2026-06-02 — started milestone v2.0 (Voice Interface)*
