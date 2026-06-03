# Phase 15: Audio I/O + Model Runtime - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 20 (15 new, 5 modified)
**Analogs found:** 18 / 20 (2 no-analog: whisper.cpp sidecar wrapper, AudioWorklet processor)

> Read alongside `15-CONTEXT.md` (20 locked decisions) and `15-RESEARCH.md` (project structure §, pitfalls §).
> The RESEARCH project-structure tree is the file manifest; this doc assigns each entry a real codebase analog with line-cited excerpts.

---

## ⚠️ Spec-vs-Codebase Corrections (planner MUST apply)

Two RESEARCH/CONTEXT assumptions do NOT match the codebase. Fix in PLAN.md before they ship:

1. **There is NO `user_prefs` table.** CONTEXT D-08 and RESEARCH §Migration Plan both say `ALTER TABLE user_prefs ADD COLUMN voice_model_ready`. Grepping `embedded.ts` (1566 lines) finds only `settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)` (migration 001, line 26) and `learned_preferences` (migration ~1270). **Model-readiness is a key-value pref → use the `settings` kv table via the `src/main/background/prefs.ts` namespaced-key pattern** (`INSERT … ON CONFLICT(k) DO UPDATE`), NOT an `ALTER TABLE`. This likely makes migration ≥136 **unnecessary** (no schema change) — confirm during planning. If a column is still wanted, it must target a real table. This is the recurring "Spec vs codebase reality" failure mode (project memory).

2. **CSP `script-src` does NOT allow `blob:`** (RESEARCH assumption A2 — now CONFIRMED a gap). `src/main/index.ts:156` prod CSP = `script-src 'self';` (no `blob:`). The D-19 inline-Blob-URL AudioWorklet **will fail to register in the packaged build** until `blob:` is added to `script-src` in both `prodCspHeader()` (L153) and `devCspHeader()` (L163). This is a Wave-0 packaging task, not an afterthought. Editing the CSP requires a grep-verified edit per the T-01-01b-05 convention noted in the same file.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/voice/stt/sidecar-manager.ts` | service (child-process) | streaming / batch | `src/main/tray/icons.ts` (resourcesPath resolve) + `child_process` (no in-repo analog) | partial — resolve-pattern only |
| `src/main/voice/download/model-download.ts` | service | file-I/O / streaming | `src/main/release/updater.ts` + `makeRendererEmitter` (entitlement.ts) | role-match |
| `src/main/ipc/voice.ts` | route (IPC handlers) | request-response + push | `src/main/ipc/entitlement.ts` | exact |
| `src/main/voice/prefs.ts` *(model-readiness, NEW)* | utility (kv pref) | CRUD | `src/main/background/prefs.ts` | exact |
| `src/main/db/migrations/136_*.sql` + `embedded.ts` | migration | — | `embedded.ts` migration 135 entry + `settings` table | role-match (likely N/A — see correction 1) |
| `src/shared/voice-types.ts` | model (DTOs) | — | `src/shared/ipc-contract.ts` DTO blocks | exact |
| `src/preload/index.ts` *(MODIFY)* | provider (IPC bridge) | push subscribe | preload `onNavigate` / `entitlementOnStateChanged` overrides | exact |
| `src/shared/ipc-contract.ts` *(MODIFY)* | config (channel registry) | — | `CHANNELS` + `AriaApi` blocks | exact |
| `src/renderer/features/voice/useVoiceSession.ts` | store (Zustand + IPC) | event-driven | `AppShellNavigateListener` (App.tsx) push-subscribe + Zustand stores | role-match |
| `src/renderer/features/voice/capture/mic-worklet.ts` | utility (worklet src) | streaming | none (Web Audio API) | no analog |
| `src/renderer/features/voice/capture/useMicCapture.ts` | hook | streaming | none direct; `getUserMedia` | no analog (UI-shell analog only) |
| `src/renderer/features/voice/VoicePTTButton.tsx` | component | event-driven | `TrialBanner.tsx` (editorial button) | role-match |
| `src/renderer/features/voice/VoiceHUDBand.tsx` | component | event-driven | `src/renderer/features/entitlement/TrialBanner.tsx` | exact (same shell slot) |
| `src/renderer/features/voice/VoiceStatusDot.tsx` | component | event-driven | `src/renderer/components/editorial/StatusDot.tsx` | exact (wrap) |
| `src/renderer/features/voice/VoiceModelDownload.tsx` | component (modal) | request-response | `TrialBanner.tsx` disabled-gate + `OnboardingWizard` step | role-match |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | hook | streaming | none direct (kokoro-js) | no analog |
| `src/renderer/components/Topbar.tsx` *(MODIFY)* | component | — | self (right cluster L145-177) | exact |
| `src/renderer/app/App.tsx` *(MODIFY)* | component (shell) | — | self (`<TrialBanner/>` slot L106) | exact |
| `src/renderer/features/onboarding/OnboardingWizard.tsx` *(MODIFY)* | component (wizard) | — | self (Step state machine) | exact |
| `tests/static/voice-audio-no-cloud.spec.ts` *(NEW ratchet)* | test (static guard) | — | `tests/static/voice-routes-through-staging.spec.ts` | exact |

---

## Pattern Assignments

### `src/main/voice/stt/sidecar-manager.ts` (service, child-process / batch)

**Analog:** `src/main/tray/icons.ts` (packaged-resource resolution) — there is **no existing child_process sidecar in the repo**, so only the resource-path resolution is borrowed. The process lifecycle is net-new (RESEARCH §Pattern 1).

**Resource-path resolution to mirror** (`src/main/tray/icons.ts:23-35`) — apply this verbatim shape to locate the `whisper-cli[.exe]` binary in `extraResources` and the downloaded GGML model:
```typescript
function resolveAssetDir(): string {
  try {
    if (app?.isPackaged && process.resourcesPath) {
      return process.resourcesPath;
    }
  } catch {
    /* electron mock without isPackaged */
  }
  // Dev/test fallback: walk up from out/main → build.
  return path.join(__dirname, '..', '..', '..', 'build');
}
```
The identical `app.isPackaged ? process.resourcesPath : __dirname/../../build` branch appears in `src/main/index.ts:267-284` (`resolveBrandIcon`) — use whichever fallback depth matches the binary's `extraResources` `to:` mapping.

**Power lifecycle (D-03)** — register suspend/resume via `src/main/lifecycle/powerMonitor.ts:32`:
```typescript
const unregister = registerLifecycleCallbacks({
  onSuspend: () => sidecar.pause(),   // kill/park child on sleep
  onResume:  () => sidecar.resume(),  // respawn on wake
});
```

**Net-new (no analog — see RESEARCH §Pattern 1 & §Pitfall 1):** `child_process.spawn` of `whisper-cli`, JSON-lines stdio framing, the VAD-endpoint→temp-WAV→CLI→`--output-json` protocol (CLI is file-based, NOT a PCM stdin stream — issue #3521), and `try/finally` temp-WAV cleanup + crash/exit handler (§Pitfall 4). **Lives under `src/main/voice/**` → the `voice-routes-through-staging.spec.ts` ratchet fences it**: never import `sendApprovedEmail` / `applyCalendarChange` / `pushApprovedMeetingActions`, never write `approval_path:'explicit'`.

---

### `src/main/voice/download/model-download.ts` (service, file-I/O / streaming)

**Analog:** `src/main/release/updater.ts` (download progress + powerMonitor) + the push-emitter from `src/main/ipc/entitlement.ts`.

**Renderer push pattern** — copy `makeRendererEmitter` verbatim (`src/main/ipc/entitlement.ts:114-124`); emit download progress on each NDH `progress` event:
```typescript
export function makeRendererEmitter(
  win: BrowserWindow | null,
): (channel: string, payload?: unknown) => void {
  return (channel, payload) => {
    try {
      win?.webContents?.send(channel, payload);
    } catch {
      /* renderer may be torn down */
    }
  };
}
```
Inject it as a `emitToRenderer?: (channel, payload?) => void` dep (entitlement.ts:27) so the manager is unit-testable without a window.

**Pause/resume on power events** — same `registerLifecycleCallbacks` pattern as the sidecar (powerMonitor.ts:32): `onSuspend: () => dl.pause()`, `onResume: () => dl.resume()` (D-09).

**Net-new:** `node-downloader-helper` `DownloadHelper` wiring (RESEARCH §Pattern 4) — `resumeIfFileExists`, `resumeOnIncomplete`, HF URL. Write the model into `app.getPath('userData')` (NOT `extraResources` — the binary ships, the model downloads). Lives under `src/main/voice/**` → ratchet applies.

---

### `src/main/ipc/voice.ts` (route, request-response + push)

**Analog:** `src/main/ipc/entitlement.ts` — **exact match.** Mirror its shape exactly.

**Handler-registration + DI shape** (`src/main/ipc/entitlement.ts:19-45`):
```typescript
export interface VoiceHandlersDeps {
  logger: Logger;
  dbHolder: DbHolder;          // see ./onboarding
  // services: sidecar manager, download manager, prefs
  emitToRenderer?: (channel: string, payload?: unknown) => void;
}

export function registerVoiceHandlers(ipcMain: IpcMain, deps: VoiceHandlersDeps): void {
  ipcMain.handle(CHANNELS.VOICE_GET_MODEL_STATUS, async () => {
    try {
      return { ok: true, /* … */ };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  // …feedAudio (renderer→main PCM), startTranscribe, cancelTts
}
```

**Push events to renderer** (entitlement.ts:56,103 — `deps.emitToRenderer?.(CHANNELS.X, payload)`): emit `VOICE_TRANSCRIPT_DELTA`, `VOICE_STATE_CHANGED`, `VOICE_MODEL_PROGRESS` exactly this way.

**db-null guard** — see entitlement.ts:84 (`deps.dbHolder.db?.prepare(...)`). IPC handlers registered pre-unlock must tolerate `db === null`; pref reads must default gracefully (cf. `getBackgroundPrefs(db: Db | null)` returning defaults when null). Per project memory (IPC db-null skip trap), if voice handlers are db-dependent, re-register post-unlock and keep the skip.add inside the `if (db)` guard.

**Note:** `src/main/ipc/voice.ts` is NOT under `src/main/voice/**`, so the staging-ratchet does not fence it — but it must still never reach the write chokepoints (Phase 15 has no write paths; Ratchet B `chokepoint-caller-allow-list` covers all of `src/main`).

---

### `src/main/voice/prefs.ts` (utility, CRUD — model-readiness)  ← replaces the migration

**Analog:** `src/main/background/prefs.ts` — **exact match.** Persist model-readiness as a namespaced key in the existing `settings(k,v)` table (correction 1 above). No `ALTER TABLE`, no new table.

**Write pattern** (`src/main/background/prefs.ts:106-109`):
```typescript
db.prepare(
  `INSERT INTO settings (k, v) VALUES (?, ?)
   ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
).run(fullKey('voiceModelReady'), serialise(value));
```

**Read-with-default + null-db tolerance** (prefs.ts:114-129): `getVoiceModelStatus(db: Db | null)` returns a default (`{ ready: false, path: null }`) when `db` is null or keys missing — mirrors `getBackgroundPrefs`. Namespace keys e.g. `voice.modelReady`, `voice.modelPath`, `voice.modelState` (0=absent / 1=ready / 2=downloading per D-08).

---

### `src/shared/voice-types.ts` (model, DTOs)

**Analog:** `src/shared/ipc-contract.ts` DTO blocks (e.g. `GmailIntegrationStatus` L345, `ApprovalUiState` L556). Define `VoiceState`, `TranscriptDelta`, `VoiceModelStatus` as plain exported interfaces/unions. **D-17: the `VoiceState` union MUST include `'speaking'`** so Phase 16 streaming output drops in:
```typescript
export type VoiceState =
  | 'idle' | 'listening' | 'processing'
  | 'speaking'              // D-17 — Phase 16 seam, present now
  | 'muted-during-playback' | 'error';
```
Renderer never imports from `src/main`; this shared file is the contract (see ipc-contract.ts:553-555 comment).

---

### `src/shared/ipc-contract.ts` (config — channel registry) *(MODIFY)*

**Analog:** self. Add `VOICE_*` keys to the `CHANNELS` const (pattern L9-181) and matching methods to `AriaApi` (L765-1050). Follow the **push-event convention**: comment the channel as a push event and add an optional subscription helper at the bottom of `AriaApi` (cf. `onNavigate?` L1043-1049, `onResearchReportDone?` L1040):
```typescript
// in CHANNELS:
  VOICE_FEED_AUDIO: 'aria:voice:feed-audio',        // renderer→main (invoke)
  VOICE_GET_MODEL_STATUS: 'aria:voice:model-status',
  VOICE_DOWNLOAD_MODEL: 'aria:voice:download-model',
  VOICE_CANCEL_TTS: 'aria:voice:cancel-tts',
  VOICE_TRANSCRIPT_DELTA: 'aria:voice:transcript-delta',  // push (ipcRenderer.on)
  VOICE_STATE_CHANGED: 'aria:voice:state-changed',        // push
  VOICE_MODEL_PROGRESS: 'aria:voice:model-progress',      // push
// in AriaApi (subscription helpers, like onNavigate):
  onVoiceTranscript?: (cb: (d: TranscriptDelta) => void) => () => void;
  onVoiceState?: (cb: (s: VoiceState) => void) => () => void;
  onVoiceModelProgress?: (cb: (p: { receivedBytes: number; totalBytes: number }) => void) => () => void;
```
⚠️ esbuild skips tsc — run `npm run typecheck` after editing this file (project memory `esbuild_skips_typecheck`).

---

### `src/preload/index.ts` (provider — IPC bridge) *(MODIFY)*

**Analog:** self — the `onNavigate` (L41-46) and `entitlementOnStateChanged` (L29-34) override blocks are the **exact** pattern for push subscriptions. Invoke methods (`voiceFeedAudio`, `voiceGetModelStatus`, etc.) are auto-mapped by the `buildApi()` loop (L13-21); only the push channels need a manual `ipcRenderer.on` override:
```typescript
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTranscript = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
};
```
Repeat for `onVoiceState` (VOICE_STATE_CHANGED) and `onVoiceModelProgress` (VOICE_MODEL_PROGRESS). PCM frames go the other way (renderer→main) via the auto-mapped `voiceFeedAudio(arrayBuffer)` invoke — D-19's transferable `ArrayBuffer` is passed as the invoke arg.

---

### `src/renderer/features/voice/useVoiceSession.ts` (store, event-driven)

**Analog:** `AppShellNavigateListener` (`src/renderer/app/App.tsx:201-218`) for the push-subscribe-in-`useEffect`-with-unsubscribe-cleanup pattern:
```typescript
useEffect(() => {
  if (typeof window === 'undefined' || !window.aria?.onVoiceTranscript) return;
  const unsub = window.aria.onVoiceTranscript((d) => { /* update store */ });
  return () => { unsub(); };
}, []);
```
**Net-new:** the Zustand store itself (state machine `idle → listening → processing → (result) → idle`, `micGated` flag). CONTEXT names Zustand for client state; subscribe to all three push channels (transcript/state/progress) at mount. **D-13 half-duplex gate lives here**: `micGated=true` on turn-start AND for full TTS playback duration; PTT start blocked while `speaking`.

---

### `src/renderer/features/voice/VoiceStatusDot.tsx` (component, event-driven)

**Analog:** `src/renderer/components/editorial/StatusDot.tsx` — **exact.** D-14: NO new tokens; map voice states onto the existing 4-color vocabulary (StatusDot.tsx:9-14):
```typescript
const KIND_TO_COLOR: Record<StatusDotKind, string> = {
  ok: 'var(--moss)',    // → speaking
  warn: 'var(--gold)',  // → listening (pulse) / processing (spinner arc)
  err: 'var(--rose)',   // → error
  idle: 'var(--gray-faint)',  // → idle / muted-during-playback
};
```
Wrap `StatusDot` and add the listening slow-pulse / processing spinner-arc / muted struck-mic overlays. `prefers-reduced-motion` → instant toggle + static fill (D-16; see GateLoadingScreen's `@media (prefers-reduced-motion: reduce)` block in App.tsx:133-136 for the in-repo precedent).

---

### `src/renderer/features/voice/VoiceHUDBand.tsx` (component, event-driven)

**Analog:** `src/renderer/features/entitlement/TrialBanner.tsx` — **exact structural match** (same shell slot, same `role="status"`, same editorial tone styling).

**Shell-slot placement** — App.tsx:106 mounts `<TrialBanner/>` in-flow, first child of `<main>`, above `<Topbar/>`. D-15: mount `<VoiceHUDBand/>` at the **same structural position** (in-flow between Topbar and the scrollable content div), NOT a floating overlay (no z-index conflict with ToastHost/CommandPalette).

**Accessible status region + editorial styling** (TrialBanner.tsx:119-147): use `role="status"` — but D-15 specifies `aria-live="polite" aria-atomic="false"` (announce incremental words). Reuse the mono-uppercase eyebrow + `--paper`/`--ink`/`--gold`/`--rule` token vocabulary:
```tsx
<div role="status" aria-live="polite" aria-atomic="false"
     style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 20px',
              background:'var(--paper)', borderBottom:'1px solid var(--rule)' }}>
  <span aria-hidden="true" style={{ fontFamily:'var(--f-mono)', fontSize:10,
        letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--gold)' }}>
    Listening
  </span>
  <span style={{ flex:1 }}>{liveTranscript}</span>
</div>
```
Collapse to dot-only when idle (D-15) — RESEARCH §Open-Q4 recommends `grid-template-rows: 0fr/1fr` over `max-height`.

---

### `src/renderer/features/voice/VoiceModelDownload.tsx` (component, request-response)

**Analog:** `TrialBanner.tsx` disabled-gate tone + `OnboardingWizard` step shape. D-08 "voice unavailable until ready" = **disabled PTT affordance routing to the download flow** — mirror the entitlement disabled-state pattern. Subscribe to `onVoiceModelProgress`; show size disclosure **before** download starts (D-07), pause/resume buttons, and the graceful "voice unavailable" state. Two entry points (D-07): (a) the OnboardingWizard step (below) and (b) this as a lazy first-PTT modal.

---

### `src/renderer/features/voice/VoicePTTButton.tsx` (component, event-driven)

**Analog:** editorial `Button` (used in `OnboardingWizard.tsx:264`, imported from `../../components/editorial`). **Net-new behavior (D-10):** DOM `keydown`/`keyup` hold-to-talk (`keyup`=hard turn-end) PLUS click-toggle on the same hook. NO `globalShortcut` (electron #26301 — no keyup). VAD dual-role config (D-11) lives in the capture hook, switched by a `setVadMode('hold'|'toggle')` (RESEARCH §Pattern 5 threshold table).

---

### `mic-worklet.ts`, `useMicCapture.ts`, `useKokoroPlayer.ts` (no codebase analog)

Pure Web Audio / library integrations — see RESEARCH §Pattern 2 (Blob URL worklet — **blocked on CSP correction 2**), §Pattern 3 (Kokoro renderer webgpu→wasm), §Pattern 5 (VAD). No existing Aria code does `getUserMedia`/`AudioWorklet`/ONNX-in-renderer. Planner uses RESEARCH excerpts directly. `useMicCapture` handles `devicechange` hot-swap + permission-denied → ToastHost error (D-20; ToastHost is the existing transient-error surface, App.tsx:113).

---

### `src/renderer/components/Topbar.tsx` *(MODIFY)*

**Analog:** self. Right cluster is `⌘K button (L122) → bell span (L146) → AvatarMenu (L177)` (RESEARCH §Pitfall 5 verified this). Insert `<VoiceStatusDot/>` **between the bell and AvatarMenu** (or left of ⌘K) — pick one and document it. It is a flex row (L80-92); a new child shifts the cluster, so coordinate placement.

---

### `src/renderer/app/App.tsx` *(MODIFY)*

**Analog:** self. Add `<VoiceHUDBand/>` adjacent to `<TrialBanner/>` (L106), in-flow first children of `<main>`. Optionally add a `VoiceSessionProvider` wrapper if the store is context-based; otherwise the hook is mounted by the components that use it.

---

### `src/renderer/features/onboarding/OnboardingWizard.tsx` *(MODIFY)*

**Analog:** self. Append a **skippable** `'voice'` step to the `Step` union (L19-27) and the render chain (after `'news-picker'`, before `'password'` — or after seal, since the model download needs `userData` which exists pre-seal). The step buffers a "set up voice now / skip" choice and triggers `VoiceModelDownload`. Mirror the existing buffer-then-persist pattern (`newsSelection` → persisted in `seal()`, L91-104). D-07: skip path makes the lazy first-PTT modal mandatory anyway.

---

### `tests/static/voice-audio-no-cloud.spec.ts` *(NEW ratchet)*

**Analog:** `tests/static/voice-routes-through-staging.spec.ts` — **exact.** Copy its `walk()` + `stripComments()` + missing-dir-guard skeleton (L37-53). New guard for VOICE-04: no file under `src/main/voice/**` (or the renderer voice feature dir) references a cloud STT/TTS endpoint (e.g. `api.openai.com/v1/audio`, `speech`, frontier transcription URLs). Same `expect(offenders).toEqual([])` assertion shape (L85-89). The **existing** `voice-routes-through-staging.spec.ts` already fences the new `src/main/voice/stt/**` and `download/**` files automatically (its `walk(VOICE_ROOT)` is recursive) — no edit needed there; just don't violate it.

---

## Shared Patterns

### Packaged-resource resolution (binary + model)
**Source:** `src/main/tray/icons.ts:23-35` and `src/main/index.ts:267-284` (`resolveBrandIcon`)
**Apply to:** `sidecar-manager.ts` (whisper-cli binary in `extraResources`), `model-download.ts` (model dest in `userData`)
```typescript
const candidate = app.isPackaged
  ? path.join(process.resourcesPath, file)
  : path.join(__dirname, '../../build', file);
```

### Main→renderer push events
**Source:** `src/main/ipc/entitlement.ts:114-124` (`makeRendererEmitter`) + preload `onNavigate` (`src/preload/index.ts:41-46`)
**Apply to:** all `VOICE_*` push channels (transcript delta, state, model progress). Inject `emitToRenderer?` as a handler dep; subscribe in the renderer via a preload `ipcRenderer.on` override returning an unsubscribe fn.

### powerMonitor suspend/resume
**Source:** `src/main/lifecycle/powerMonitor.ts:32-45` (`registerLifecycleCallbacks`)
**Apply to:** sidecar lifecycle (D-03) and download pause (D-09). Returns an unregister fn — call it on teardown.

### Key-value pref persistence (db-null tolerant)
**Source:** `src/main/background/prefs.ts:106-129`
**Apply to:** voice model-readiness (`settings` kv table, namespaced key; default when db null). Replaces the assumed `user_prefs` migration (correction 1).

### Editorial UI tokens (no new design tokens)
**Source:** `StatusDot.tsx:9-14`, `TrialBanner.tsx:90-108`, `Topbar.tsx` mono eyebrow
**Apply to:** all voice components. Use `--moss / --gold / --rose / --gray-faint` for state, `--paper / --ink / --rule`, `--f-mono` uppercase eyebrow. `prefers-reduced-motion` → instant toggle (precedent: App.tsx:133-136).

### Static-guard ratchet
**Source:** `tests/static/voice-routes-through-staging.spec.ts:37-114`
**Apply to:** the new no-cloud-audio ratchet. `walk` + `stripComments` + missing-dir guard + `expect(offenders).toEqual([])`.

### Channel-contract discipline
**Source:** `src/shared/ipc-contract.ts` + `src/preload/index.ts` buildApi loop
**Apply to:** every new IPC channel. Add to `CHANNELS` + `AriaApi`, run `npm run typecheck` (esbuild skips tsc — project memory).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/main/voice/stt/sidecar-manager.ts` (process mgmt) | service | streaming/batch | No `child_process` sidecar exists in the repo; only the resource-resolve sub-pattern is borrowed. Process lifecycle, JSON-lines framing, WAV-segment protocol are net-new (RESEARCH §Pattern 1, §Pitfall 1/4) |
| `src/renderer/features/voice/capture/mic-worklet.ts` | utility | streaming | No Web Audio / AudioWorklet code in Aria. RESEARCH §Pattern 2 (blocked on CSP correction 2) |
| `src/renderer/features/voice/capture/useMicCapture.ts` | hook | streaming | No `getUserMedia` / device-hot-swap code exists. RESEARCH §Pattern 2/5, D-20 |
| `src/renderer/features/voice/tts/useKokoroPlayer.ts` | hook | streaming | No ONNX-in-renderer / kokoro-js code exists. RESEARCH §Pattern 3, §Kokoro Deep Dive |

These four use RESEARCH §Architecture Patterns excerpts as their source of truth, not a codebase analog.

---

## Metadata

**Analog search scope:** `src/main/{tray,ipc,lifecycle,voice,background,db/migrations,release}`, `src/renderer/{app,components,components/editorial,features/entitlement,features/onboarding}`, `src/preload`, `src/shared`, `tests/static`
**Files scanned:** 14 read in full or targeted; `ipc-contract.ts` (1566L) and `embedded.ts` (1566+L) read via targeted offsets/greps
**Pattern extraction date:** 2026-06-03
