/**
 * Ollama localhost probe (Plan 03 Task 2).
 *
 * Performs two GETs against http://127.0.0.1:11434:
 *   - /api/version → { version: string }
 *   - /api/tags    → { models: [{ name, ... }] }
 *
 * Never throws. Returns OllamaStatus with `reachable: false` and an error tag
 * on connect-refused / timeout / non-2xx. The default timeout is 2000ms via
 * AbortSignal.timeout (Node 20 global). Plan-04 will reuse this probe.
 *
 * Threat mitigation: T-01-03-04 (renderer hang on unreachable Ollama).
 */
import type { OllamaStatus } from '../../shared/ipc-contract';

const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 2000;

function classifyError(err: unknown): 'timeout' | 'unreachable' {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
    if (e.cause?.code === 'ECONNREFUSED') return 'unreachable';
  }
  return 'unreachable';
}

export async function probeOllama(opts?: {
  timeoutMs?: number;
}): Promise<OllamaStatus> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const [verRes, tagsRes] = await Promise.all([
      fetch(`${OLLAMA_BASE}/api/version`, { signal }),
      fetch(`${OLLAMA_BASE}/api/tags`, { signal }),
    ]);
    if (!verRes.ok || !tagsRes.ok) {
      return { reachable: false, models: [], error: 'unreachable' };
    }
    const verJson = (await verRes.json()) as { version?: string };
    const tagsJson = (await tagsRes.json()) as { models?: Array<{ name?: string }> };
    const models = (tagsJson.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string');
    return {
      reachable: true,
      version: verJson.version,
      models,
    };
  } catch (err) {
    return { reachable: false, models: [], error: classifyError(err) };
  }
}
