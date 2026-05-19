import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RagDisconnectedSection } from '../../../../../src/renderer/features/settings/RagDisconnectedSection';

function setupAria() {
  const ragAccountChunkCounts = vi.fn();
  const providerAccountsList = vi.fn();
  const ragWipeAccount = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).aria = {
    ragAccountChunkCounts,
    providerAccountsList,
    ragWipeAccount,
  };
  return { ragAccountChunkCounts, providerAccountsList, ragWipeAccount };
}

describe('RagDisconnectedSection', () => {
  beforeEach(() => {
    setupAria();
  });

  it('renders nothing when no disconnected accounts have chunks', async () => {
    const { ragAccountChunkCounts, providerAccountsList } = setupAria();
    ragAccountChunkCounts.mockResolvedValue({ rows: [] });
    providerAccountsList.mockResolvedValue({ rows: [] });
    const { container } = render(<RagDisconnectedSection />);
    await waitFor(() => expect(ragAccountChunkCounts).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="rag-disconnected-section"]')).toBeNull();
  });

  it('renders one row per disconnected account w/ chunk count', async () => {
    const { ragAccountChunkCounts, providerAccountsList } = setupAria();
    ragAccountChunkCounts.mockResolvedValue({
      rows: [{ providerKey: 'google', accountId: 'old@x.com', count: 142 }],
    });
    providerAccountsList.mockResolvedValue({
      rows: [
        {
          providerKey: 'google',
          accountId: 'old@x.com',
          displayEmail: 'old@x.com',
          status: 'disconnected',
        },
      ],
    });
    render(<RagDisconnectedSection />);
    await waitFor(() => expect(ragAccountChunkCounts).toHaveBeenCalled());
    expect(await screen.findByTestId('rag-disc-row-google-old@x.com')).toBeInTheDocument();
    expect(screen.getByText(/142 chunks/)).toBeInTheDocument();
  });

  it('Wipe button → confirm dialog → confirm → ragWipeAccount called', async () => {
    const { ragAccountChunkCounts, providerAccountsList, ragWipeAccount } = setupAria();
    ragAccountChunkCounts
      .mockResolvedValueOnce({
        rows: [{ providerKey: 'microsoft', accountId: 'old@x.com', count: 7 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    providerAccountsList.mockResolvedValue({
      rows: [
        {
          providerKey: 'microsoft',
          accountId: 'old@x.com',
          displayEmail: 'old@x.com',
          status: 'disconnected',
        },
      ],
    });
    ragWipeAccount.mockResolvedValue({ deletedChunks: 7 });
    render(<RagDisconnectedSection />);
    await waitFor(() => expect(ragAccountChunkCounts).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('rag-wipe-microsoft-old@x.com'));
    expect(screen.getByTestId('rag-wipe-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rag-wipe-confirm-button'));
    await waitFor(() => expect(ragWipeAccount).toHaveBeenCalledWith({
      providerKey: 'microsoft',
      accountId: 'old@x.com',
    }));
  });

  it('Cancel dismisses dialog without wiping', async () => {
    const { ragAccountChunkCounts, providerAccountsList, ragWipeAccount } = setupAria();
    ragAccountChunkCounts.mockResolvedValue({
      rows: [{ providerKey: 'google', accountId: 'a@x', count: 3 }],
    });
    providerAccountsList.mockResolvedValue({
      rows: [
        {
          providerKey: 'google',
          accountId: 'a@x',
          displayEmail: 'a@x',
          status: 'disconnected',
        },
      ],
    });
    render(<RagDisconnectedSection />);
    await waitFor(() => expect(ragAccountChunkCounts).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('rag-wipe-google-a@x'));
    fireEvent.click(screen.getByTestId('rag-wipe-cancel'));
    expect(screen.queryByTestId('rag-wipe-confirm')).toBeNull();
    expect(ragWipeAccount).not.toHaveBeenCalled();
  });
});
