/**
 * Plan 10-03 Task 1 — KnowledgeFoldersSection unit tests.
 *
 * Uses vitest + @testing-library/react against a stub window.aria.knowledge IPC.
 *
 * Test cases:
 *  1. Renders existing folders from listFolders stub.
 *  2. Above-threshold add: prescan returns exceedsThreshold -> confirm dialog;
 *     Cancel does NOT call addFolder; Continue opens modal then addFolder called.
 *  3. Below-threshold add: prescan returns !exceedsThreshold -> modal opens directly.
 *  4a. Destructive-remove (split 1): Remove click renders confirm dialog.
 *  4b. Destructive-remove (split 2): Cancel does NOT call removeFolder; folder remains.
 *  4c. Destructive-remove (split 3): Confirm Remove calls removeFolder with folderId.
 *  5. Sensitivity toggle calls setSensitivity with the new value; badge updates.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeFoldersSection } from './KnowledgeFoldersSection';

// ─── IPC stub ────────────────────────────────────────────────────────────────

const mockFolder = {
  id: 'folder-1',
  path: '/Users/dev/docs',
  label: 'My Docs',
  sensitivity: 'general' as const,
  status: 'active' as const,
  fileCount: 42,
  bytesIndexed: 1024 * 1024 * 10, // 10 MB
  lastScanAt: '2026-05-21T08:00:00.000Z',
  lastError: null,
};

function makeAriaMock(overrides: Partial<typeof window.aria> = {}): typeof window.aria {
  return {
    knowledgeListFolders: vi.fn().mockResolvedValue({ folders: [mockFolder] }),
    knowledgePickFolder: vi.fn().mockResolvedValue({ path: '/tmp/new-folder' }),
    knowledgePrescanFolder: vi.fn().mockResolvedValue({ fileCount: 100, totalBytes: 1024 * 1024, exceedsThreshold: false }),
    knowledgeAddFolder: vi.fn().mockResolvedValue({ folderId: 'folder-2' }),
    knowledgeRemoveFolder: vi.fn().mockResolvedValue({ ok: true }),
    knowledgeSetSensitivity: vi.fn().mockResolvedValue({ ok: true, folderUpdated: 1, chunksUpdated: 3 }),
    knowledgeReindex: vi.fn().mockResolvedValue({ ok: true }),
    knowledgeFolderStats: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as typeof window.aria;
}

beforeEach(() => {
  window.aria = makeAriaMock();
});

// ─── Test 1: renders existing folders ────────────────────────────────────────

describe('KnowledgeFoldersSection — renders', () => {
  it('renders existing folders from listFolders stub', async () => {
    render(<KnowledgeFoldersSection />);
    await waitFor(() => {
      expect(screen.getByText('My Docs')).toBeDefined();
    });
    expect(screen.getByTestId('kf-folder-card-folder-1')).toBeDefined();
    expect(screen.getByTestId('kf-sensitivity-badge-folder-1').textContent).toBe('General');
    expect(screen.getByTestId('kf-file-count-folder-1').textContent).toBe('42');
  });
});

// ─── Test 2: above-threshold add path ────────────────────────────────────────

describe('KnowledgeFoldersSection — above-threshold add', () => {
  it('shows threshold confirm when prescan returns exceedsThreshold:true; Cancel does NOT call addFolder; Continue opens modal then addFolder is called', async () => {
    // Setup: prescan returns exceedsThreshold:true
    window.aria = makeAriaMock({
      knowledgePrescanFolder: vi.fn().mockResolvedValue({
        fileCount: 6000,
        totalBytes: 3 * 1024 * 1024 * 1024, // 3 GB
        exceedsThreshold: true,
      }),
      knowledgeAddFolder: vi.fn().mockResolvedValue({ folderId: 'folder-new' }),
      knowledgeListFolders: vi.fn()
        .mockResolvedValueOnce({ folders: [mockFolder] })
        .mockResolvedValue({ folders: [mockFolder, { ...mockFolder, id: 'folder-new', label: 'New Folder' }] }),
    });

    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByText('My Docs'));

    // Click Add folder
    fireEvent.click(screen.getByTestId('kf-add-folder-btn'));
    await waitFor(() => screen.getByRole('dialog'));

    // Threshold dialog must mention file count + size
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('6,000');
    expect(dialog.textContent).toContain('GB');

    // Cancel: addFolder NOT called
    fireEvent.click(screen.getByTestId('kf-dialog-cancel'));
    expect(window.aria.knowledgeAddFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Click Add folder again, threshold dialog again, then Continue
    window.aria.knowledgePickFolder = vi.fn().mockResolvedValue({ path: '/tmp/new-folder' });
    fireEvent.click(screen.getByTestId('kf-add-folder-btn'));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByTestId('kf-dialog-confirm')); // "Continue"

    // Add-folder modal opens
    await waitFor(() => screen.getByTestId('kf-add-submit'));

    // Submit the form
    fireEvent.click(screen.getByTestId('kf-add-submit'));
    await waitFor(() => expect(window.aria.knowledgeAddFolder).toHaveBeenCalled());
    expect(window.aria.knowledgeAddFolder).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/new-folder', sensitivity: 'general' }),
    );
  });
});

// ─── Test 3: below-threshold add path ────────────────────────────────────────

describe('KnowledgeFoldersSection — below-threshold add', () => {
  it('opens add modal directly when prescan returns exceedsThreshold:false', async () => {
    window.aria = makeAriaMock({
      knowledgePrescanFolder: vi.fn().mockResolvedValue({
        fileCount: 50,
        totalBytes: 512 * 1024,
        exceedsThreshold: false,
      }),
    });

    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByText('My Docs'));

    fireEvent.click(screen.getByTestId('kf-add-folder-btn'));
    // Should jump straight to add-folder modal (no threshold dialog)
    await waitFor(() => screen.getByTestId('kf-add-submit'));
    // No threshold text visible
    expect(screen.queryByText(/Initial indexing will take a while/i)).toBeNull();
  });
});

// ─── Test 4a: Destructive-remove split 1 — dialog renders ────────────────────

describe('KnowledgeFoldersSection — destructive-remove split 1', () => {
  it('clicking Remove renders the confirm dialog containing the folder label', async () => {
    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByText('My Docs'));

    fireEvent.click(screen.getByTestId('kf-remove-folder-1'));
    const dialog = await waitFor(() => screen.getByRole('dialog'));
    expect(dialog.textContent).toContain('My Docs');
  });
});

// ─── Test 4b: Destructive-remove split 2 — cancel preserves folder ───────────

describe('KnowledgeFoldersSection — destructive-remove split 2', () => {
  it('Cancel does NOT call removeFolder and the folder remains in the list', async () => {
    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByText('My Docs'));

    fireEvent.click(screen.getByTestId('kf-remove-folder-1'));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByTestId('kf-dialog-cancel'));

    expect(window.aria.knowledgeRemoveFolder).not.toHaveBeenCalled();
    // Dialog gone
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Folder still visible
    expect(screen.getByText('My Docs')).toBeDefined();
  });
});

// ─── Test 4c: Destructive-remove split 3 — confirm removes folder ─────────────

describe('KnowledgeFoldersSection — destructive-remove split 3', () => {
  it('confirming Remove calls removeFolder with the correct folderId and folder disappears after refresh', async () => {
    window.aria = makeAriaMock({
      knowledgeRemoveFolder: vi.fn().mockResolvedValue({ ok: true }),
      knowledgeListFolders: vi.fn()
        .mockResolvedValueOnce({ folders: [mockFolder] })
        .mockResolvedValue({ folders: [] }), // folder gone after remove
    });

    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByText('My Docs'));

    fireEvent.click(screen.getByTestId('kf-remove-folder-1'));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByTestId('kf-dialog-confirm'));

    await waitFor(() => expect(window.aria.knowledgeRemoveFolder).toHaveBeenCalledWith({ folderId: 'folder-1' }));
    await waitFor(() => expect(screen.queryByText('My Docs')).toBeNull());
  });
});

// ─── Test 5: Sensitivity toggle ──────────────────────────────────────────────

describe('KnowledgeFoldersSection — sensitivity toggle', () => {
  it('calls setSensitivity with the new value; badge updates after refresh', async () => {
    const sensitiveFolder = { ...mockFolder, sensitivity: 'sensitive' as const };
    window.aria = makeAriaMock({
      knowledgeListFolders: vi.fn()
        .mockResolvedValueOnce({ folders: [mockFolder] })
        .mockResolvedValue({ folders: [sensitiveFolder] }),
      knowledgeSetSensitivity: vi.fn().mockResolvedValue({ ok: true, folderUpdated: 1, chunksUpdated: 3 }),
    });

    render(<KnowledgeFoldersSection />);
    await waitFor(() => screen.getByTestId('kf-sensitivity-badge-folder-1'));
    expect(screen.getByTestId('kf-sensitivity-badge-folder-1').textContent).toBe('General');

    fireEvent.click(screen.getByTestId('kf-flip-sensitivity-folder-1'));

    await waitFor(() =>
      expect(window.aria.knowledgeSetSensitivity).toHaveBeenCalledWith({
        folderId: 'folder-1',
        sensitivity: 'sensitive',
      }),
    );

    // After refresh, badge should show Sensitive
    await waitFor(() => expect(screen.getByTestId('kf-sensitivity-badge-folder-1').textContent).toBe('Sensitive'));
  });
});
