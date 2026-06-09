/**
 * R-WA05 → Plan 20-07 Task 3 — WhatsAppGroupPickerModal spec.
 *
 * Asserts:
 *   1. The search field filters the displayed group rows.
 *   2. Toggling a group checkbox fires WHATSAPP_SET_TRACKED IPC.
 *   3. Newly-joined untracked groups sort to the top of the list.
 *
 * The component does not exist yet; this spec RED-fails until Plan 20-07
 * (WhatsAppGroupPickerModal.tsx) lands.
 *
 * Run: npx vitest run tests/unit/renderer/whatsapp-groups.spec.tsx
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Component under test — does not exist yet; RED-fails until Plan 20-07 lands.
import { WhatsAppGroupPickerModal } from '../../../src/renderer/components/WhatsAppGroupPickerModal';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

/** Minimal group row shape matching WHATSAPP_LIST_GROUPS response */
interface GroupRow {
  jid: string;
  displayName: string;
  memberCount: number;
  tracked: boolean;
  isNew?: boolean; // newly-joined, not yet seen
}

const sampleGroups: GroupRow[] = [
  { jid: 'alpha@g.us', displayName: 'Alpha Team', memberCount: 10, tracked: true },
  { jid: 'beta@g.us', displayName: 'Beta Squad', memberCount: 5, tracked: false },
  { jid: 'gamma@g.us', displayName: 'Gamma Crew', memberCount: 3, tracked: false },
];

const groupsWithNew: GroupRow[] = [
  { jid: 'alpha@g.us', displayName: 'Alpha Team', memberCount: 10, tracked: true },
  { jid: 'beta@g.us', displayName: 'Beta Squad', memberCount: 5, tracked: false },
  {
    jid: 'newgroup@g.us',
    displayName: 'New Untracked Group',
    memberCount: 8,
    tracked: false,
    isNew: true,
  },
];

describe('WhatsAppGroupPickerModal — search/filter (R-WA05)', () => {
  it('renders a search field', () => {
    const aria = {
      whatsappListGroups: vi.fn().mockResolvedValue({ rows: sampleGroups }),
      whatsappSetTracked: vi.fn().mockResolvedValue({ ok: true }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;

    render(<WhatsAppGroupPickerModal open onClose={vi.fn()} />);

    // A search/filter input must be present (D-02)
    const searchInput = screen.getByRole('searchbox') || screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeDefined();
  });

  it('search field filters group rows — typing "Beta" hides "Alpha Team"', async () => {
    const aria = {
      whatsappListGroups: vi.fn().mockResolvedValue({ rows: sampleGroups }),
      whatsappSetTracked: vi.fn().mockResolvedValue({ ok: true }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;

    const user = userEvent.setup();
    render(<WhatsAppGroupPickerModal open onClose={vi.fn()} />);

    // Wait for groups to load
    const searchInput = await screen.findByRole('searchbox').catch(
      () => screen.findByPlaceholderText(/search/i),
    );
    await user.type(searchInput, 'Beta');

    // Beta Squad should be visible, Alpha Team should be hidden
    expect(screen.queryByText('Beta Squad')).not.toBeNull();
    expect(screen.queryByText('Alpha Team')).toBeNull();
  });
});

describe('WhatsAppGroupPickerModal — toggle fires WHATSAPP_SET_TRACKED (R-WA05)', () => {
  it('toggling a group checkbox calls whatsappSetTracked with the group jid and new tracked state', async () => {
    const whatsappSetTracked = vi.fn().mockResolvedValue({ ok: true });
    const aria = {
      whatsappListGroups: vi.fn().mockResolvedValue({ rows: sampleGroups }),
      whatsappSetTracked,
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;

    const user = userEvent.setup();
    render(<WhatsAppGroupPickerModal open onClose={vi.fn()} />);

    // Find the Beta Squad row (untracked → click to track)
    const betaToggle = await screen.findByTestId('group-toggle-beta@g.us');
    await user.click(betaToggle);

    expect(whatsappSetTracked).toHaveBeenCalledWith({
      jid: 'beta@g.us',
      tracked: true,
    });
  });
});

describe('WhatsAppGroupPickerModal — new untracked groups sort to top (R-WA05 / D-04)', () => {
  it('newly-joined untracked group appears at the top of the list', async () => {
    const aria = {
      whatsappListGroups: vi.fn().mockResolvedValue({ rows: groupsWithNew }),
      whatsappSetTracked: vi.fn().mockResolvedValue({ ok: true }),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;

    render(<WhatsAppGroupPickerModal open onClose={vi.fn()} />);

    // Wait for groups to appear
    const newGroupEl = await screen.findByText('New Untracked Group');
    const alphaEl = await screen.findByText('Alpha Team');

    // "New Untracked Group" must appear before "Alpha Team" in the DOM
    const allItems = Array.from(document.querySelectorAll('[data-testid^="group-row-"]'));
    const newIdx = allItems.findIndex((el) => el.textContent?.includes('New Untracked Group'));
    const alphaIdx = allItems.findIndex((el) => el.textContent?.includes('Alpha Team'));

    expect(newIdx).toBeLessThan(alphaIdx);
  });
});

describe('WhatsAppGroupPickerModal — modal visibility (R-WA05)', () => {
  it('does not render group rows when open=false', () => {
    const aria = {
      whatsappListGroups: vi.fn().mockResolvedValue({ rows: sampleGroups }),
      whatsappSetTracked: vi.fn(),
    };
    (globalThis as unknown as { window: { aria: typeof aria } }).window.aria = aria;

    render(<WhatsAppGroupPickerModal open={false} onClose={vi.fn()} />);

    // When not open, the group rows should not be present
    expect(screen.queryByText('Alpha Team')).toBeNull();
  });
});
