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
}

contextBridge.exposeInMainWorld('aria', api);

// Type augmentation for renderer consumers.
declare global {
  interface Window {
    aria: AriaApi;
  }
}
