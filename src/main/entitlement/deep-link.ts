/**
 * Plan 08.1-02 Task 9 — aria://activate?key=... deep-link handler.
 *
 * Parses the URL, validates scheme + host + key param, then calls
 * EntitlementService.activate. The renderer is notified via the
 * ENTITLEMENT_STATE_CHANGED event so the paywall UX can react.
 *
 * Routing: src/main/single-instance.ts forwards `aria://` URLs from
 * `second-instance` (Windows/Linux) and `open-url` (macOS) events.
 * `app.setAsDefaultProtocolClient('aria')` is called at startup in index.ts.
 */
import type { EntitlementService } from './service';

export interface ParsedActivateUrl {
  license_key: string;
}

export function parseActivateDeepLink(url: string): ParsedActivateUrl | null {
  if (typeof url !== 'string' || !url.startsWith('aria://')) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'aria:') return null;
  // Hostname OR pathname == 'activate' (URL parsing of custom schemes is
  // platform-finicky — accept both).
  const hostOrPath =
    (parsed.hostname || '').toLowerCase() ||
    parsed.pathname.replace(/^\/+/, '').replace(/\/.*$/, '').toLowerCase();
  if (hostOrPath !== 'activate') return null;
  const key = parsed.searchParams.get('key');
  if (!key) return null;
  return { license_key: key };
}

export interface ActivateResult {
  ok: boolean;
  error?: string;
}

export type StateChangedEmitter = () => void;

export interface HandleActivateDeps {
  service: EntitlementService;
  emitStateChanged?: StateChangedEmitter;
}

export async function handleActivateDeepLink(
  url: string,
  deps: HandleActivateDeps,
): Promise<ActivateResult> {
  const parsed = parseActivateDeepLink(url);
  if (!parsed) return { ok: false, error: 'invalid-deep-link' };
  try {
    await deps.service.activate(parsed.license_key);
  } catch (err) {
    return {
      ok: false,
      error: (err as { code?: string }).code ?? (err as Error).message,
    };
  }
  try {
    deps.emitStateChanged?.();
  } catch {
    /* notify is best-effort */
  }
  return { ok: true };
}
