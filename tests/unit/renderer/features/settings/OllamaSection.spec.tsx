/**
 * OllamaSection renderer tests — dropdown + save + error path.
 *
 * Covers the user-configurable Ollama model picker (Phase 2 UAT Test 7 fix).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OllamaSection } from '../../../../../src/renderer/features/settings/OllamaSection';

interface AriaStub {
  ollamaStatus: ReturnType<typeof vi.fn>;
  ollamaGetActiveModel: ReturnType<typeof vi.fn>;
  ollamaSetActiveModel: ReturnType<typeof vi.fn>;
}

function installAria(opts: {
  reachable?: boolean;
  models?: string[];
  active?: { modelId: string | null; source: 'persisted' | 'default' | 'auto-picked' };
  setResult?: { ok: true; modelId: string } | { ok: false; error: string };
}): AriaStub {
  const stub: AriaStub = {
    ollamaStatus: vi.fn().mockResolvedValue({
      reachable: opts.reachable ?? true,
      version: '0.4.0',
      models: opts.models ?? ['dolphin3:latest', 'llama3.1:8b'],
    }),
    ollamaGetActiveModel: vi.fn().mockResolvedValue(
      opts.active ?? { modelId: 'dolphin3:latest', source: 'persisted' },
    ),
    ollamaSetActiveModel: vi.fn().mockResolvedValue(
      opts.setResult ?? { ok: true, modelId: 'llama3.1:8b' },
    ),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
  vi.clearAllTimers();
});

describe('OllamaSection — user-configurable model', () => {
  it('renders the dropdown populated from ollamaStatus.models', async () => {
    installAria({
      models: ['dolphin3:latest', 'llama3.1:8b', 'qwen2.5:7b'],
    });
    render(<OllamaSection />);
    const select = (await screen.findByTestId('ollama-model-select')) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(['dolphin3:latest', 'llama3.1:8b', 'qwen2.5:7b']),
    );
  });

  it('shows the active model + provenance pill from ollamaGetActiveModel', async () => {
    installAria({
      active: { modelId: 'dolphin3:latest', source: 'persisted' },
    });
    render(<OllamaSection />);
    await waitFor(() =>
      expect(screen.getByTestId('ollama-active-model').textContent).toContain('dolphin3:latest'),
    );
    expect(screen.getByTestId('ollama-active-provenance').textContent).toBe('persisted');
  });

  it('clicking Save calls ollamaSetActiveModel with the chosen model id', async () => {
    const stub = installAria({
      models: ['dolphin3:latest', 'llama3.1:8b'],
      active: { modelId: 'dolphin3:latest', source: 'persisted' },
    });
    const user = userEvent.setup();
    render(<OllamaSection />);
    const select = (await screen.findByTestId('ollama-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('dolphin3:latest'));
    await user.selectOptions(select, 'llama3.1:8b');
    await user.click(screen.getByTestId('ollama-model-save'));
    await waitFor(() => expect(stub.ollamaSetActiveModel).toHaveBeenCalledTimes(1));
    expect(stub.ollamaSetActiveModel).toHaveBeenCalledWith({ modelId: 'llama3.1:8b' });
  });

  it('renders inline error when setActive returns model-not-installed', async () => {
    installAria({
      models: ['dolphin3:latest', 'llama3.1:8b'],
      active: { modelId: 'dolphin3:latest', source: 'persisted' },
      setResult: { ok: false, error: 'model-not-installed' },
    });
    const user = userEvent.setup();
    render(<OllamaSection />);
    const select = (await screen.findByTestId('ollama-model-select')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('dolphin3:latest'));
    await user.selectOptions(select, 'llama3.1:8b');
    await user.click(screen.getByTestId('ollama-model-save'));
    const err = await screen.findByTestId('ollama-model-error');
    expect(err.textContent).toBe('model-not-installed');
  });

  it('hides the dropdown when Ollama is unreachable', async () => {
    installAria({ reachable: false, models: [] });
    render(<OllamaSection />);
    await waitFor(() =>
      expect(screen.queryAllByText(/Install Ollama/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId('ollama-model-select')).toBeNull();
  });
});
