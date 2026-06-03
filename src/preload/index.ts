/**
 * Preload bridge — the ONLY surface the renderer touches.
 *
 * Built by mapping every CHANNELS entry to its camelCase AriaApi method, each
 * delegating to `ipcRenderer.invoke`. The renderer never imports from
 * 'electron'; it only uses `window.aria` typed against `AriaApi`.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, CHANNEL_METHODS, type AriaApi } from '../shared/ipc-contract';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

function buildApi(): AriaApi {
  const api: Record<string, AnyFn> = {};
  for (const key of Object.keys(CHANNELS) as Array<keyof typeof CHANNELS>) {
    const channel = CHANNELS[key];
    const method = CHANNEL_METHODS[key];
    api[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }
  return api as unknown as AriaApi;
}

const api = buildApi();

// Plan 08.1-02 — entitlement-state-changed event subscription. Overrides the
// auto-mapped `invoke`-style stub with a real `ipcRenderer.on` listener that
// returns an unsubscribe function. The renderer calls
// `window.aria.entitlementOnStateChanged(cb)` to subscribe.
(api as unknown as Record<string, AnyFn | ((cb: (payload: unknown) => void) => () => void)>)
  .entitlementOnStateChanged = (cb: (payload: unknown) => void) => {
  const handler = (_e: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(CHANNELS.ENTITLEMENT_STATE_CHANGED, handler);
  return () => ipcRenderer.removeListener(CHANNELS.ENTITLEMENT_STATE_CHANGED, handler);
};

// Phase 12 / Plan 12-03 — aria:navigate push channel.
// Overrides the auto-mapped invoke stub with a real ipcRenderer.on listener.
// Main process sends this channel (hardcoded paths only — T-12-10).
// Returns an unsubscribe function for cleanup in useEffect.
// The allowlist (['/briefing', '/approvals']) is enforced in App.tsx.
(api as unknown as Record<string, ((cb: (path: string) => void) => () => void)>)
  .onNavigate = (cb: (path: string) => void) => {
  const handler = (_e: unknown, path: string) => cb(path);
  ipcRenderer.on(CHANNELS.NAVIGATE, handler);
  return () => ipcRenderer.removeListener(CHANNELS.NAVIGATE, handler);
};

// Phase 15 / Plan 15-01 — Voice push channels.
// Overrides the auto-mapped invoke stubs with real ipcRenderer.on listeners.
// Each returns an unsubscribe function for useEffect cleanup (same pattern as
// onNavigate / entitlementOnStateChanged above). The invoke-direction channels
// (voiceFeedAudio, voiceGetModelStatus, voiceDownloadModel, voiceCancelTts)
// are auto-mapped by buildApi() and need no manual override.
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTranscript = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TRANSCRIPT_DELTA, handler);
};

(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceState = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_STATE_CHANGED, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_STATE_CHANGED, handler);
};

(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceModelProgress = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_MODEL_PROGRESS, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_MODEL_PROGRESS, handler);
};

// E2E-only escape hatches; gated by ARIA_E2E env var so production builds
// never expose them. Used by the Plan 03-01 crash-recovery spec to seed a
// 'generating' approval row before forcing a process exit.
if (process.env['ARIA_E2E'] === '1') {
  const bag = api as unknown as Record<string, AnyFn>;
  bag['__e2eInsertGenerating'] = (req: unknown) =>
    ipcRenderer.invoke('aria:approvals:__e2e_insert_generating__', req);
  // Plan 03-04 Task 5 — approve-and-send e2e harness hooks.
  bag['__e2eSeedReady'] = (req: unknown) =>
    ipcRenderer.invoke('aria:approvals:__e2e_seed_ready__', req);
  bag['__e2eReadApproval'] = (req: unknown) =>
    ipcRenderer.invoke('aria:approvals:__e2e_read_row__', req);
  bag['__e2eReadSendLog'] = (req: unknown) =>
    ipcRenderer.invoke('aria:approvals:__e2e_read_send_log__', req);
  bag['__e2eSetGmailMock'] = (req: unknown) =>
    ipcRenderer.invoke('aria:gmail:__e2e_set_mock__', req);
  bag['__e2eGetGmailCalls'] = () =>
    ipcRenderer.invoke('aria:gmail:__e2e_get_calls__');
  bag['__e2eClearGmailCalls'] = () =>
    ipcRenderer.invoke('aria:gmail:__e2e_clear_calls__');
  // Plan 04-03 calendar e2e bridges.
  bag['__e2eSeedCalEvent'] = (req: unknown) =>
    ipcRenderer.invoke('aria:scheduling:__e2e_seed_event__', req);
  bag['__e2eSetCalMock'] = (req: unknown) =>
    ipcRenderer.invoke('aria:scheduling:__e2e_set_mock__', req);
  bag['__e2eGetCalCalls'] = () =>
    ipcRenderer.invoke('aria:scheduling:__e2e_get_calls__');
  bag['__e2eClearCalCalls'] = () =>
    ipcRenderer.invoke('aria:scheduling:__e2e_clear_calls__');
  bag['__e2eReadCalAudit'] = (req: unknown) =>
    ipcRenderer.invoke('aria:scheduling:__e2e_read_audit__', req);
}

// Plan 10-01: knowledge folder channels (KNOWLEDGE_PICK_FOLDER, KNOWLEDGE_PRESCAN_FOLDER,
// KNOWLEDGE_ADD_FOLDER, KNOWLEDGE_LIST_FOLDERS, KNOWLEDGE_REMOVE_FOLDER,
// KNOWLEDGE_FOLDER_STATS, KNOWLEDGE_REINDEX) are auto-mapped by the buildApi() loop
// above via the CHANNELS / CHANNEL_METHODS registry in ipc-contract.ts.

contextBridge.exposeInMainWorld('aria', api);

// Type augmentation for renderer consumers.
declare global {
  interface Window {
    aria: AriaApi;
  }
}
