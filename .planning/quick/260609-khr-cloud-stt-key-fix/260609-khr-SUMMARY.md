---
phase: 260609-khr
plan: 01
subsystem: voice
tags: [cloud-stt, whisper, safeStorage, key-resolution, logging]
dependency_graph:
  requires: [safeStorage, @ai-sdk/openai createOpenAI, voice IPC]
  provides: [cloudTranscribe key resolution, STT route observability]
  affects: [src/main/voice/cloud-stt.ts, src/main/ipc/voice.ts]
tech_stack:
  added: []
  patterns: [injectable-getter for unit test isolation, getFrontierKey safeStorage pattern]
key_files:
  created: []
  modified:
    - src/main/voice/cloud-stt.ts
    - src/main/ipc/voice.ts
    - tests/unit/main/voice/cloud-stt.spec.ts
decisions:
  - key getter defaults to getFrontierKey provider:openai — always fetches openai key regardless of active frontier provider (whisper-1 is OpenAI-only)
  - null key returns { error } immediately — no network call, no hang (T-khr-02 mitigated)
metrics:
  duration: ~10 minutes
  completed: 2026-06-09
---

# Quick 260609-khr: Cloud STT Key Fix — Summary

**One-liner:** Wire cloudTranscribe to safeStorage OpenAI key via injectable getter + add per-turn STT route logs to VOICE_FEED_AUDIO.

## What Was Done

### Task 1: Fix cloudTranscribe key resolution

`cloud-stt.ts` was using the bare `openai` provider from `@ai-sdk/openai`, which reads
`process.env.OPENAI_API_KEY`. Since the key is stored in Electron safeStorage (not in env),
every whisper-1 call was silently 401-ing and falling back to the local sidecar.

**Fix:** Replaced `import { openai }` with `import { createOpenAI }` and added
`import { getFrontierKey }`. The function signature gained an optional third parameter:

```ts
getKey: () => Promise<string | null> = () => getFrontierKey({ provider: 'openai' })
```

Logic: resolve key first, return `{ error: 'no OpenAI frontier key configured' }` if null
(never throws), then build `createOpenAI({ apiKey: key }).transcription('whisper-1')` inside
the try block.

### Task 2: Add route log lines to VOICE_FEED_AUDIO

Added `logger.info({ route: useCloudPath ? 'cloud' : 'local' }, 'voice.stt route')` immediately
after the `useCloudPath` assignment. Updated the cloud-error fallback warn message to
`'voice.stt cloud failed — falling back to local'` for clarity.

### Test updates

Updated `cloud-stt.spec.ts`:
- Mock updated from `openai.transcription` stub to `createOpenAI` factory stub
- Added null-key test: `cloudTranscribe(buf, signal, () => null)` → `{ error: 'no OpenAI frontier key configured' }`, `mockTranscribe` not called
- All existing `cloudTranscribe` tests now inject `() => Promise.resolve('sk-test')` as the key getter

`cloud-stt-routing.spec.ts` required no changes — it mocks `cloudTranscribe` as a dep-injected
function and does not call the real implementation.

## Verification

| Check | Result |
|-------|--------|
| `cloud-stt.spec.ts` (10 tests) | PASS |
| `cloud-stt-routing.spec.ts` (3 tests) | PASS |
| `grep -c "{ openai }" src/main/voice/cloud-stt.ts` | 0 |
| `grep -c "from '@ai-sdk/openai'" src/main/voice/cloud-stt.ts` | 1 (createOpenAI) |
| `grep -c "voice.stt route" src/main/ipc/voice.ts` | 1 |
| typecheck error count | 84 (baseline unchanged) |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The key flows
in-process only (safeStorage → cloudTranscribe memory → OpenAI SDK). The null-key
early-return satisfies T-khr-02 (no hang on missing key).

## Self-Check

- [x] `src/main/voice/cloud-stt.ts` modified with createOpenAI + injectable getter
- [x] `src/main/ipc/voice.ts` modified with route log line
- [x] `tests/unit/main/voice/cloud-stt.spec.ts` updated with new tests
- [x] Commit `75231e7` exists
- [x] Typecheck baseline 84 — no new errors

## Self-Check: PASSED
