import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AskScreen } from '../../../../../src/renderer/features/ask/AskScreen';
import { AnswerCard } from '../../../../../src/renderer/features/ask/AnswerCard';
import { CitationList } from '../../../../../src/renderer/features/ask/CitationList';
import type {
  RagCitationDto,
  RagAskResponse,
} from '../../../../../src/shared/ipc-contract';

function setupAria() {
  const ragAsk = vi.fn();
  const ragThreadList = vi.fn(async () => ({ threads: [] }));
  const ragThreadGet = vi.fn(async () => null);
  const ragOpenSource = vi.fn(async () => ({ ok: true as const }));
  const providerAccountsList = vi.fn(async () => ({ rows: [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).aria = {
    ragAsk,
    ragThreadList,
    ragThreadGet,
    ragOpenSource,
    providerAccountsList,
  };
  return { ragAsk, ragThreadList, ragThreadGet, ragOpenSource, providerAccountsList };
}

const cit = (i: number, kind: RagCitationDto['sourceKind'] = 'email'): RagCitationDto => ({
  index: i,
  sourceKind: kind,
  sourceId: `s${i}`,
  title: `T${i}`,
  snippet: `snip-${i}`,
  charStart: 0,
  charEnd: 10,
  occurredAt: '2026-05-19T15:30:00Z',
  accountChip: { provider: 'google', email: 'me@example.com', disconnected: false },
});

describe('AnswerCard visual modes', () => {
  it('refusal uses EXACT verbatim copy and renders as neutral grey', () => {
    const refusal: RagAskResponse = {
      kind: 'refusal',
      text: "I couldn't find anything in your data about that.",
      threadId: 't',
      turnId: 'u',
    };
    render(<AnswerCard response={refusal} userIanaTz="UTC" />);
    expect(screen.getByTestId('answer-refusal')).toHaveTextContent(
      "I couldn't find anything in your data about that.",
    );
    expect(screen.queryByTestId('answer-error')).toBeNull();
  });

  it('error renders as red Alert with retry', () => {
    const err: RagAskResponse = { kind: 'error', text: 'down' };
    const onRetry = vi.fn();
    render(<AnswerCard response={err} userIanaTz="UTC" onRetry={onRetry} />);
    const node = screen.getByTestId('answer-error');
    expect(node).toHaveAttribute('role', 'alert');
    fireEvent.click(within(node).getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('disambiguation candidate click → onDisambiguate(personId)', () => {
    const onDisambiguate = vi.fn();
    const dis: RagAskResponse = {
      kind: 'disambiguation',
      candidates: [
        { personId: 'p:1', displayName: 'Sarah S', canonicalEmail: 's1@x', recentContext: '' },
        { personId: 'p:2', displayName: 'Sarah J', canonicalEmail: 's2@x', recentContext: '' },
      ],
      threadId: 't',
    };
    render(<AnswerCard response={dis} userIanaTz="UTC" onDisambiguate={onDisambiguate} />);
    fireEvent.click(screen.getByTestId('disambiguate-p:2'));
    expect(onDisambiguate).toHaveBeenCalledWith('p:2');
  });

  it('directoryStale → hint rendered (C10)', () => {
    const ans: RagAskResponse = {
      kind: 'answer',
      text: 'r',
      citations: [cit(1)],
      routing: {
        route: 'FRONTIER',
        modelId: 'm',
        sensitivity: 'none',
        reason: 'r',
        directoryStale: true,
      },
      threadId: 't',
      turnId: 'u',
    };
    render(<AnswerCard response={ans} userIanaTz="UTC" />);
    expect(screen.getByTestId('directory-stale-hint')).toBeInTheDocument();
  });
});

describe('CitationList — TZ + account chips + click', () => {
  beforeEach(() => setupAria());

  it('renders timestamp via Intl in the given IANA TZ', () => {
    render(<CitationList citations={[cit(1)]} userIanaTz="America/Los_Angeles" />);
    const t = screen.getByTestId('citation-time-1');
    // 2026-05-19T15:30Z → LA = 08:30 AM. Format is locale-dependent; just
    // assert the year + a colon exist.
    expect(t.textContent ?? '').toMatch(/2026/);
    expect(t.textContent ?? '').toMatch(/:/);
  });

  it('account chip shows disconnected variant from IPC payload (no extra query)', () => {
    const c: RagCitationDto = {
      ...cit(1),
      accountChip: { provider: 'google', email: 'me@x.com', disconnected: true },
    };
    render(<CitationList citations={[c]} userIanaTz="UTC" />);
    const chip = screen.getByTestId('citation-chip-1');
    expect(chip).toHaveAttribute('data-disconnected', 'true');
    expect(chip.textContent).toContain('disconnected');
  });

  it('click → ragOpenSource(sourceKind, sourceId, charStart, charEnd)', () => {
    const { ragOpenSource } = setupAria();
    render(<CitationList citations={[cit(1)]} userIanaTz="UTC" />);
    fireEvent.click(screen.getByTestId('citation-1'));
    expect(ragOpenSource).toHaveBeenCalledWith({
      sourceKind: 'email',
      sourceId: 's1',
      charStart: 0,
      charEnd: 10,
    });
  });
});

describe('AskScreen integration', () => {
  it('Ask submit fires ragAsk with accountFilter when chips are selected', async () => {
    const { ragAsk, providerAccountsList } = setupAria();
    providerAccountsList.mockResolvedValue({
      rows: [
        {
          providerKey: 'google',
          accountId: 'a@x',
          displayEmail: 'a@x',
          status: 'ok',
        },
      ],
    });
    ragAsk.mockResolvedValue({
      kind: 'refusal',
      text: "I couldn't find anything in your data about that.",
      threadId: 't',
      turnId: 'u',
    });
    render(
      <MemoryRouter initialEntries={['/ask']}>
        <Routes>
          <Route path="/ask" element={<AskScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(providerAccountsList).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('ask-filter-google-a@x'));
    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: 'q' } });
    fireEvent.click(screen.getByTestId('ask-submit'));
    await waitFor(() => expect(ragAsk).toHaveBeenCalled());
    expect(ragAsk.mock.calls[0]![0].accountFilter).toEqual([
      { providerKey: 'google', accountId: 'a@x' },
    ]);
  });

  it('?thread=<id> hydrates from ragThreadGet (C9 handoff)', async () => {
    const { ragThreadGet } = setupAria();
    ragThreadGet.mockResolvedValue({
      thread: { id: 'thr_seed', title: 'seeded', createdAt: 'n', updatedAt: 'n' },
      turns: [
        {
          id: 'trn1',
          threadId: 'thr_seed',
          ord: 0,
          role: 'user',
          text: 'cmd-k question',
          citations: null,
          routing: null,
          createdAt: 'n',
        },
        {
          id: 'trn2',
          threadId: 'thr_seed',
          ord: 1,
          role: 'assistant',
          text: 'cmd-k answer',
          citations: [cit(1)],
          routing: {
            route: 'FRONTIER',
            modelId: 'm',
            sensitivity: 'none',
            reason: 'r',
          },
          createdAt: 'n',
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={['/ask?thread=thr_seed']}>
        <Routes>
          <Route path="/ask" element={<AskScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(ragThreadGet).toHaveBeenCalledWith({ threadId: 'thr_seed', lastN: 100 }),
    );
    expect(await screen.findByText(/cmd-k question/)).toBeInTheDocument();
    expect(screen.getByText(/cmd-k answer/)).toBeInTheDocument();
  });

  it('transient threads are filtered out of the sidebar (C9)', async () => {
    const { ragThreadList } = setupAria();
    ragThreadList.mockResolvedValue({
      threads: [
        { id: 'a', title: '(transient) cmd-k 1', createdAt: 'n', updatedAt: 'n' },
        { id: 'b', title: 'Real thread', createdAt: 'n', updatedAt: 'n' },
      ],
    });
    render(
      <MemoryRouter initialEntries={['/ask']}>
        <Routes>
          <Route path="/ask" element={<AskScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ragThreadList).toHaveBeenCalled());
    expect(await screen.findByTestId('ask-thread-b')).toBeInTheDocument();
    expect(screen.queryByTestId('ask-thread-a')).toBeNull();
  });
});
