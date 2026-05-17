/**
 * Bootstrap helper — auto-pick the first installed Ollama model when the user
 * hasn't chosen one yet. Surfaced during Phase 2 UAT Test 7: users who pulled
 * a non-default Ollama tag (e.g. `dolphin3`) would otherwise hit `Not Found`
 * because the hardcoded `DEFAULT_LOCAL_MODEL` doesn't match anything they have
 * installed.
 *
 * Idempotent: skips on every subsequent boot once `getModelId()` returns
 * non-null. Never picks when Ollama is unreachable (would race on probe
 * failure) or when the tags list is empty.
 *
 * Pure-function shape so it's unit-testable without spinning up Electron.
 */
export interface AutoPickDeps {
  logger: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
  getModelId: () => string | null;
  setModelId: (id: string) => void;
  probe: () => Promise<{ reachable: boolean; models: string[] }>;
}

export async function autoPickOllamaModel(deps: AutoPickDeps): Promise<void> {
  try {
    if (deps.getModelId() !== null) return;
    const status = await deps.probe();
    if (!status.reachable) return;
    if (status.models.length === 0) return;
    const picked = status.models[0]!;
    deps.setModelId(picked);
    deps.logger.info(
      { scope: 'ollama', event: 'auto-picked-model', modelId: picked },
      'auto-picked first installed Ollama model',
    );
  } catch (err) {
    deps.logger.warn(
      { scope: 'ollama', err: (err as Error).message },
      'auto-pick of Ollama model failed (non-fatal)',
    );
  }
}
