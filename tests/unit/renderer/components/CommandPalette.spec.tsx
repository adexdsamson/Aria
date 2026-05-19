import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette } from '../../../../src/renderer/components/CommandPalette';

function setupAria() {
  const ragAsk = vi.fn();
  const ragThreadCreate = vi.fn();
  const ragThreadList = vi.fn(async () => ({ threads: [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).aria = {
    ragAsk,
    ragThreadCreate,
    ragThreadList,
  };
  return { ragAsk, ragThreadCreate, ragThreadList };
}

function fireCmdK() {
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
  });
}

function fireCtrlK() {
  act(() => {
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
  });
}

describe('CommandPalette — keyboard + Expand-to-chat (REVIEWS C9)', () => {
  beforeEach(() => {
    setupAria();
  });

  it('Cmd+K opens, Cmd+K again closes (preventDefault honored)', () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('command-palette-root')).toBeNull();
    fireCmdK();
    expect(screen.getByTestId('command-palette-root')).toBeInTheDocument();
    fireCmdK();
    expect(screen.queryByTestId('command-palette-root')).toBeNull();
  });

  it('Ctrl+K also toggles (Windows/Linux)', () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCtrlK();
    expect(screen.getByTestId('command-palette-root')).toBeInTheDocument();
  });

  it('Enter on input calls ragAsk with transient=true', async () => {
    const { ragAsk } = setupAria();
    ragAsk.mockResolvedValue({
      kind: 'answer',
      text: 'r [1]',
      citations: [
        { index: 1, sourceKind: 'email', sourceId: 's', title: 'Subject', snippet: 'snip', charStart: 0, charEnd: 4 },
      ],
      routing: { route: 'FRONTIER', modelId: 'm', sensitivity: 'none', reason: 'rag-answer:non-sensitive' },
      threadId: 'thr_x',
      turnId: 'trn_x',
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(ragAsk).toHaveBeenCalledTimes(1));
    expect(ragAsk).toHaveBeenCalledWith({ question: 'hello', transient: true });
    await waitFor(() => expect(screen.getByTestId('cmdk-answer')).toBeInTheDocument());
  });

  it('refusal renders as neutral grey, NOT red error', async () => {
    const { ragAsk } = setupAria();
    ragAsk.mockResolvedValue({
      kind: 'refusal',
      text: "I couldn't find anything in your data about that.",
      threadId: 't',
      turnId: 'u',
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('cmdk-refusal')).toBeInTheDocument());
    expect(screen.queryByTestId('cmdk-error')).toBeNull();
    expect(screen.getByTestId('cmdk-refusal')).toHaveTextContent(
      "I couldn't find anything in your data about that.",
    );
  });

  it('error renders as red Alert (distinct from refusal)', async () => {
    const { ragAsk } = setupAria();
    ragAsk.mockResolvedValue({
      kind: 'error',
      text: "Aria couldn't reach the local model — please check Ollama is running",
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('cmdk-error')).toBeInTheDocument());
    expect(screen.queryByTestId('cmdk-refusal')).toBeNull();
  });

  it('Expand-to-chat calls ragThreadCreate with seedTurns = currently displayed Q+A (C9)', async () => {
    const { ragAsk, ragThreadCreate } = setupAria();
    const citations = [
      { index: 1, sourceKind: 'email' as const, sourceId: 's', title: 'T', snippet: 'snip', charStart: 0, charEnd: 4 },
    ];
    const routing = { route: 'FRONTIER' as const, modelId: 'm', sensitivity: 'none', reason: 'r' };
    ragAsk.mockResolvedValue({
      kind: 'answer',
      text: 'reply',
      citations,
      routing,
      threadId: 'thr_x',
      turnId: 'trn_x',
    });
    ragThreadCreate.mockResolvedValue({
      thread: { id: 'thr_new', title: 'q', createdAt: 'now', updatedAt: 'now' },
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('cmdk-expand-chat')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('cmdk-expand-chat'));
    await waitFor(() => expect(ragThreadCreate).toHaveBeenCalledTimes(1));
    expect(ragThreadCreate).toHaveBeenCalledWith({
      seedTurns: [
        { role: 'user', text: 'q' },
        { role: 'assistant', text: 'reply', citations, routing },
      ],
    });
  });

  it('3 Cmd-K asks WITHOUT Expand → ragThreadCreate NOT called (transient flow)', async () => {
    const { ragAsk, ragThreadCreate } = setupAria();
    ragAsk.mockResolvedValue({
      kind: 'answer',
      text: 'r',
      citations: [
        { index: 1, sourceKind: 'email', sourceId: 's', title: 'T', snippet: 'snip', charStart: 0, charEnd: 4 },
      ],
      routing: { route: 'FRONTIER', modelId: 'm', sensitivity: 'none', reason: 'r' },
      threadId: 't',
      turnId: 'u',
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    for (let i = 0; i < 3; i++) {
      fireEvent.change(input, { target: { value: `q${i}` } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(ragAsk).toHaveBeenCalledTimes(i + 1));
    }
    expect(ragThreadCreate).toHaveBeenCalledTimes(0);
  });

  it('3 Cmd-K asks WITH final Expand → exactly 1 ragThreadCreate carrying the LAST Q+A', async () => {
    const { ragAsk, ragThreadCreate } = setupAria();
    ragAsk.mockImplementation(async (req: { question: string }) => ({
      kind: 'answer',
      text: `answer-to-${req.question}`,
      citations: [
        { index: 1, sourceKind: 'email', sourceId: 's', title: 'T', snippet: 'snip', charStart: 0, charEnd: 4 },
      ],
      routing: { route: 'FRONTIER', modelId: 'm', sensitivity: 'none', reason: 'r' },
      threadId: 't',
      turnId: 'u',
    }));
    ragThreadCreate.mockResolvedValue({
      thread: { id: 'thr_z', title: 'q3', createdAt: 'n', updatedAt: 'n' },
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireCmdK();
    const input = screen.getByTestId('command-palette-input');
    for (let i = 0; i < 3; i++) {
      fireEvent.change(input, { target: { value: `q${i}` } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(ragAsk).toHaveBeenCalledTimes(i + 1));
    }
    fireEvent.click(screen.getByTestId('cmdk-expand-chat'));
    await waitFor(() => expect(ragThreadCreate).toHaveBeenCalledTimes(1));
    const call = ragThreadCreate.mock.calls[0]![0] as {
      seedTurns: Array<{ role: string; text: string }>;
    };
    expect(call.seedTurns[0]!.text).toBe('q2');
    expect(call.seedTurns[1]!.text).toBe('answer-to-q2');
  });
});
