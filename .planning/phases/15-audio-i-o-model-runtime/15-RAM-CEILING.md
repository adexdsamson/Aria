# Phase 15 RAM Ceiling Measurement

**Target machine:** 16 GB RAM, no discrete GPU (integrated graphics acceptable)
**Do NOT run on the 8 GB dev machine** — STT + TTS + Ollama 8B will swap and give misleading results
(RESEARCH §RAM Ceiling: expected total ~6.9–9.0 GB peak; guaranteed to swap on 8 GB)

**Status:** OPEN — awaiting packaged build on 16 GB machine

---

## Expected Memory Budget

| Component | Expected Peak RAM | Notes |
|-----------|------------------|-------|
| Whisper large-v3-turbo q5_0 | ~1.1–1.3 GB | Model loaded into CPU RAM; stays resident across PTT sessions (D-03 persistent sidecar) |
| Kokoro-82M ONNX (wasm fallback) | ~200–300 MB | Renderer process; webgpu device ~100–200 MB GPU (if iGPU available) |
| Ollama llama3.1 8B (Q4_K_M) | ~5.0–5.5 GB | Stays resident if Aria has already invoked it for briefing |
| Electron + Chromium | ~250–400 MB | Main + renderer + GPU processes combined |
| **Expected total (all co-resident)** | **~6.9–9.0 GB** | Low end = webgpu Kokoro + lean Electron; high end = wasm Kokoro + heavy Chromium |

---

## Measurement Procedure

### Prerequisites

1. Packaged build present (`dist/win-unpacked/Aria.exe` or `dist/mac-arm64/Aria.app`)
2. Whisper large-v3-turbo q5_0 model downloaded (`~574 MB`, visible in voice settings)
3. Ollama running with `llama3.1:8b` (or equivalent 8B Q4 model) loaded:
   ```
   ollama run llama3.1:8b "hello"   # warm the model so it stays resident
   ```
4. Task Manager (Windows) or Activity Monitor (macOS) open and sorted by Memory

### Steps

1. Launch the packaged Aria app from a fresh session (no hot-reload / dev mode)
2. Navigate to the main screen — confirm voice PTT affordance is visible and active
3. Open Task Manager → Processes tab → sort by Memory (Windows)  
   OR Activity Monitor → Memory tab → note "Memory Pressure" chart (macOS)
4. Hold PTT for ~10 seconds while speaking a sentence
5. While STT is transcribing (processing state), note the peak memory
6. Wait for TTS playback to complete (Kokoro echo utterance)
7. Note the peak memory during TTS playback
8. Record all readings in the table below

### Memory Snapshot Commands (optional — for precise numbers)

**Windows (PowerShell):**
```powershell
# While PTT session is active:
Get-Process -Name "Aria","ollama" | Select-Object Name,WorkingSet64 | Format-Table
# WorkingSet64 is in bytes; divide by 1GB for GB
```

**macOS (Terminal):**
```bash
# While PTT session is active:
ps aux | grep -E "Aria|ollama" | awk '{print $11, $6}' | sort
# RSS column is in KB; divide by 1024/1024 for GB
```

---

## Results (fill in during measurement)

### Platform: Windows

| Measurement Point | Aria.exe (MB) | ollama.exe (MB) | Peak Total (GB) | Notes |
|-------------------|---------------|-----------------|-----------------|-------|
| Baseline (app open, no voice) | — | — | — | |
| PTT hold start (listening state) | — | — | — | |
| STT decoding (processing state) | — | — | — | Whisper model active |
| TTS playback (speaking state) | — | — | — | Kokoro active |
| After cooldown (idle) | — | — | — | |

**Peak observed:** _____ GB  
**Swap activity observed:** [ ] None [ ] Light [ ] Heavy thrash  
**App responsiveness during peak:** [ ] Responsive [ ] Sluggish [ ] Unresponsive  

**Verdict (Windows):** [ ] PASS — responsive, no swap thrash, no OOM  [ ] FAIL — see notes

---

### Platform: macOS

| Measurement Point | Aria (MB) | ollama (MB) | Peak Total (GB) | Notes |
|-------------------|-----------|-------------|-----------------|-------|
| Baseline (app open, no voice) | — | — | — | |
| PTT hold start (listening state) | — | — | — | |
| STT decoding (processing state) | — | — | — | Whisper model active |
| TTS playback (speaking state) | — | — | — | Kokoro active |
| After cooldown (idle) | — | — | — | |

**Peak observed:** _____ GB  
**Swap activity observed:** [ ] None [ ] Light [ ] Heavy thrash  
**App responsiveness during peak:** [ ] Responsive [ ] Sluggish [ ] Unresponsive  

**Verdict (macOS):** [ ] PASS — responsive, no swap thrash, no OOM  [ ] FAIL — see notes  
*(requires macOS binary procurement — Task 2 deferred to CI)*

---

## Pass/Fail Criteria

**PASS:** App remains responsive, no perceptible swap thrash, no OOM kill during a 10-second PTT session with Ollama 8B loaded. Peak total below 12 GB (leaving 4 GB headroom on a 16 GB machine).

**FAIL:** Any of the following:
- App becomes unresponsive (> 5 second input lag) during transcription
- System swap file grows > 2 GB during the session
- OOM killer terminates any process
- Peak total exceeds 14 GB (< 2 GB headroom — risk zone for background OS activity)

**If FAIL:** Record the peak and note which component dominates. Options:
- Whisper q5_0 too large → try q4_0 (smaller, higher WER); deferred to Phase 17 voice-settings
- Ollama 8B too heavy → note for Phase 17 RAM-aware load/unload scheduling
- Kokoro wasm too large → check if webgpu path is available (reduces to GPU RAM)

---

## Notes / Observations

*(fill in during measurement)*

---

## Measurement Date

- Windows measurement: _______________
- macOS measurement: _______________ *(pending macOS binary procurement)*
- Measured by: _______________
- Phase 15 status: VOICE-04 RAM ceiling proof — OPEN until filled
