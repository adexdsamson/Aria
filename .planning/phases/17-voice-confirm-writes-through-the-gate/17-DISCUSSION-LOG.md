# Phase 17: Voice-Confirm + Writes Through the Gate - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 17-voice-confirm-writes-through-the-gate
**Areas discussed:** Voice intent routing & parsing, Read-back + dual-channel confirm, Mishear recovery / cancel, Cloud opt-in + sensitivity routing
**Mode:** advisor (full_maturity; technical framing — NON_TECHNICAL_OWNER resolved false). Each area researched by a parallel gsd-advisor-researcher before selection.

---

## Voice intent parsing (dispatch settled: thin-wrapper service extraction, B1 — only ask.ts refactored)

| Option | Description | Selected |
|--------|-------------|----------|
| Keyword pre-filter → per-domain extraction | Deterministic pre-filter → reuse Phase-4 parseIntent + DraftSchema + ThreadSummarySchema; unknown bucket | ✓ |
| Single generateObject union | One Zod discriminated union over 5 intents; risks truncation/drift | |
| Extend Phase-4 parseIntent | Make scheduling-only parseIntent the common entry; breaks Phase-4 tests | |

**User's choice:** Keyword pre-filter → per-domain extraction. **Notes:** Dispatch = B1 thin-wrapper (draftReply/proposeCalendarChange/pushApprovedMeetingActions already extracted; only ask.ts→ask-service.ts). → D-01, D-02, D-03.

---

## Dual-channel confirm (read-back text settled: template-built from resolved row, not LLM)

| Option | Description | Selected |
|--------|-------------|----------|
| Spoken affirmative (short STT) + visible ApprovalCard | Both channels active; reuses ApprovalCard + voiceConfirm seam | ✓ |
| PTT-hold + on-screen tap | Voice channel illusory (tap is only approve signal) | |
| Voice-only + passive card | 2nd channel not confirmatory; weakens trust posture | |

**User's choice:** Spoken affirmative + visible ApprovalCard. **Notes:** Read-back = template (D-05); confirm-guard = LLM classifier + re-prompt max 2 (D-06); forced→renderer suppresses voice-confirm + explicit-required chip (D-07); ambiguous person-resolver → pre-staging numbered disambiguation (D-08). → D-04..D-08.

---

## Mishear recovery / cancel (confirm-guard settled: LLM classifier + re-prompt)

| Option | Description | Selected |
|--------|-------------|----------|
| PTT-to-cancel + mandatory Cancel button → new 'cancelled' state | Extend bargeIn(); button 2nd channel; audit-clear terminal state | ✓ |
| PTT-to-cancel + button → reuse 'expired' | No migration; loses cancel-vs-timeout audit distinction | |
| Always-on cancel-word listener | Violates half-duplex (#47043 self-trigger on "cancel"); licensing | |

**User's choice:** PTT-to-cancel + Cancel button → new 'cancelled' state. **Notes:** barge-in in awaiting-confirm aborts the staged 'ready' approval via pendingApprovalId ref (D-10); after cancel → idle, re-press to re-state (D-12). → D-09..D-12.

---

## Cloud opt-in + sensitivity routing (consent settled: single master toggle + disclosure)

| Option | Description | Selected |
|--------|-------------|----------|
| Cloud STT + non-streaming cloud answer; defer streaming | Buffered tokenize/rehydrate round-trip; StreamingRehydrator → Phase 18 | ✓ |
| Cloud STT only | Answers stay fully local; smallest surface | |
| Full frontier streaming now | Build StreamingRehydrator; PII-leak risk surface | |

**User's choice:** Cloud STT + non-streaming cloud answer; defer streaming. **Notes:** single master consent + disclosure + audit (D-14); per-turn sensitivity fail-safe local, sensitive always on-device (D-15); voice settings via voice/prefs.ts KV honored per turn (D-16). → D-13..D-16. Write-capability ratchet update → D-17.

---

## Claude's Discretion
- Affirmative/cancel vocab + LLM classifier prompt; read-back template phrasing; VoiceSection layout; speed select values; 'cancelled' migration mechanics; unknown-intent re-prompt copy.

## Deferred Ideas
- Frontier voice STREAMING + StreamingRehydrator → Phase 18 first task.
- Always-on cancel-word / hands-free barge-in → Phase 18 (wake-word licensing + AEC).
- Per-provider / dual cloud toggles → if 2nd provider added.
- GPU whisper / voice-priority queue / captions → Phase 19.
