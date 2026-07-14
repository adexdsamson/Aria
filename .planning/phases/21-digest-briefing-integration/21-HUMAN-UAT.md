---
status: partial
phase: 21-digest-briefing-integration
source: [21-VERIFICATION.md]
started: 2026-06-10T00:00:00Z
updated: 2026-07-14T00:00:00Z
---

## Current Test

number: 2
name: Ollama-offline degradation is visible in the UI
expected: |
  With Ollama stopped, the digest writes NULL rows and the briefing renders the "unavailable" state — "Digest unavailable — the local model was offline this morning. Aria will retry tonight." — with no frontier API call made.
awaiting: user response

## Tests

### 1. Live morning briefing renders the WhatsApp section
expected: After the 05:00 digest cron runs (or via a manual trigger), opening the daily briefing shows a WhatsApp section with one sub-section per tracked group (decisions / open questions / @mentions / waiting-on), summarized by the local model only.
result: pass
note: |
  Confirmed 2026-07-14. WhatsApp section rendered under the tracked group name
  ("Aria test") with local-model summary (key points / decisions / open
  questions / mentions) over the 4 ingested messages, LOCAL route. Priority
  Email correctly showed the empty state (Gmail disconnected) — the earlier
  news-into-email leak is fixed. Required fixes to get here: enrich WhatsApp on
  all briefing payload paths (59506b2) + clamp LLM sections to candidate ids
  (652ac7a). Follow-up (non-blocking): restyle the section to match sibling
  section design.

### 2. Ollama-offline degradation is visible in the UI
expected: With Ollama stopped, the digest writes NULL rows and the briefing renders the "unavailable" state — "Digest unavailable — the local model was offline this morning. Aria will retry tonight." — with no frontier API call made.
result: [pending]

### 3. "Retry digest now" button re-runs the digest locally
expected: Clicking the retry affordance on the unavailable state calls `whatsappGenerateDigestNow()` (local-only), re-runs the digest against the local model, and refreshes the section to "ready" when Ollama is back — never invoking a frontier model.
result: [pending]

### 4. Device wake after a missed 05:00 tick triggers the digest
expected: If the machine was asleep/sealed at 05:00, the `onResume` powerMonitor hook detects `MAX(date) < today` on wake and fires `runNow()` to catch up the missed digest.
result: [pending]

## Summary

total: 4
passed: 1
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
