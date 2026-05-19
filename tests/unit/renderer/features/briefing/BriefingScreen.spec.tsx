/**
 * Plan 02-04 Task 3 — BriefingScreen renderer tests (9 cases).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BriefingScreen } from '../../../../../src/renderer/features/briefing/BriefingScreen';
import type {
  BriefingPayload,
  BriefingNewsItem,
} from '../../../../../src/shared/ipc-contract';
import { NO_IMPORTANT_LABEL_COPY } from '../../../../../src/renderer/features/briefing/SectionEmail';

interface AriaStub {
  briefingToday: ReturnType<typeof vi.fn>;
  briefingGenerateNow: ReturnType<typeof vi.fn>;
  briefingRegenerateToday: ReturnType<typeof vi.fn>;
  briefingDismissNewsItem: ReturnType<typeof vi.fn>;
  briefingHistory: ReturnType<typeof vi.fn>;
  briefingGetSettings: ReturnType<typeof vi.fn>;
  briefingSetSettings: ReturnType<typeof vi.fn>;
}

function installAria(initial: unknown): AriaStub {
  const stub: AriaStub = {
    briefingToday: vi.fn().mockResolvedValue(initial),
    briefingGenerateNow: vi.fn().mockResolvedValue({ ok: true, date: '2026-05-20' }),
    briefingRegenerateToday: vi.fn(),
    briefingDismissNewsItem: vi.fn().mockResolvedValue({ ok: true }),
    briefingHistory: vi.fn().mockResolvedValue({ entries: [] }),
    briefingGetSettings: vi.fn().mockResolvedValue({ time: '07:00', tz: 'UTC' }),
    briefingSetSettings: vi.fn().mockResolvedValue({ ok: true }),
  };
  (globalThis as unknown as { window: { aria: AriaStub } }).window.aria = stub;
  return stub;
}

function makePayload(over: Partial<BriefingPayload> = {}): BriefingPayload {
  return {
    date: '2026-05-20',
    generatedAt: '2026-05-20T07:00:00.000Z',
    tz: 'UTC',
    calendar: [
      { id: 'c1', title: 'Board call', why: 'You owe a slide.' },
      { id: 'c2', title: 'Standup', why: 'Sprint demo.' },
      { id: 'c3', title: 'Investor sync', why: 'Quarterly update.' },
    ],
    email: [
      { id: 'm1', title: 'Re: Deal', why: 'Counterparty waiting.' },
      { id: 'm2', title: 'Hiring', why: 'Offer expires today.' },
      { id: 'm3', title: 'Legal', why: 'Sign before EOD.' },
    ],
    news: [
      { id: 'hn-1', title: 'A', why: 'A why', url: 'https://a.example/1', sourceKind: 'hn', dismissed: false },
      { id: 'hn-2', title: 'B', why: 'B why', url: 'https://b.example/2', sourceKind: 'hn', dismissed: false },
      { id: 'hn-3', title: 'C', why: 'C why', url: 'https://c.example/3', sourceKind: 'hn', dismissed: false },
    ],
    errors: {},
    route: 'FRONTIER',
    reason: 'generic-source-frontier-active',
    model: 'claude-sonnet-4-5',
    ...over,
  };
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('BriefingScreen', () => {
  it('Case 1 — no briefing for today → renders GenerateNowAffordance with Generate button', async () => {
    installAria({ error: 'no-briefing' });
    render(<BriefingScreen />);
    expect(await screen.findByTestId('generate-now-affordance')).toBeTruthy();
    expect(screen.getByTestId('generate-now-btn')).toBeTruthy();
  });

  it('Case 2 — briefing exists with all sections populated → 3 sections, 3 items each', async () => {
    installAria(makePayload());
    render(<BriefingScreen />);
    await screen.findByTestId('briefing-section-calendar');
    expect(screen.getAllByTestId(/^calendar-item-/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^email-item-/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^news-item-/)).toHaveLength(3);
    expect(screen.getAllByTestId('rationale').length).toBeGreaterThanOrEqual(9);
  });

  it('Phase 6 — renders Open Actions from Todoist and meeting-action tasks', async () => {
    installAria(makePayload({
      openActions: [
        { id: 'todoist:remote-1', title: 'Send QBR deck', why: 'Open task due 2026-05-20' },
      ],
    }));
    render(<BriefingScreen />);
    const section = await screen.findByTestId('briefing-open-actions');
    expect(section.textContent).toContain('Send QBR deck');
    expect(section.textContent).toContain('Open task due 2026-05-20');
  });

  it('Case 3 — top-3 cap visible: backend returns 5 items in calendar → renderer slices to 3', async () => {
    const payload = makePayload({
      calendar: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        title: `T${i}`,
        why: `w${i}`,
      })),
    });
    installAria(payload);
    render(<BriefingScreen />);
    await screen.findByTestId('briefing-section-calendar');
    expect(screen.getAllByTestId(/^calendar-item-/)).toHaveLength(3);
  });

  it('Case 4 — clicking news Dismiss calls briefingDismissNewsItem + item disappears', async () => {
    const stub = installAria(makePayload());
    const user = userEvent.setup();
    render(<BriefingScreen />);
    await screen.findByTestId('news-item-hn-1');
    await user.click(screen.getByTestId('news-dismiss-hn-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('news-item-hn-1')).toBeNull();
    });
    expect(stub.briefingDismissNewsItem).toHaveBeenCalledWith({
      date: '2026-05-20',
      urlHash: 'hn-1',
    });
  });

  it('Case 5 — per-section error: errors.email set → yellow warning; cal+news unaffected', async () => {
    installAria(makePayload({ errors: { email: 'Gmail unreachable' } }));
    render(<BriefingScreen />);
    expect(await screen.findByTestId('section-error-email')).toBeTruthy();
    expect(screen.queryByTestId('section-error-calendar')).toBeNull();
    expect(screen.queryByTestId('section-error-news')).toBeNull();
    expect(screen.getAllByTestId(/^calendar-item-/)).toHaveLength(3);
  });

  it('Case 6 — all-day calendar event renders "All day" tag', async () => {
    installAria(
      makePayload({
        calendar: [
          { id: 'cad', title: '[All day] Conference', why: 'Block off the whole day.' },
        ],
      }),
    );
    render(<BriefingScreen />);
    expect(await screen.findByTestId('calendar-item-cad-allday')).toBeTruthy();
  });

  it('Case 7 — route badge: FRONTIER vs LOCAL', async () => {
    installAria(makePayload({ route: 'FRONTIER' }));
    render(<BriefingScreen />);
    expect(await screen.findByTestId('route-badge-FRONTIER')).toBeTruthy();
    cleanup();
    installAria(makePayload({ route: 'LOCAL', reason: 'frontier-not-configured' }));
    render(<BriefingScreen />);
    expect(await screen.findByTestId('route-badge-LOCAL')).toBeTruthy();
  });

  it('Case 8 — B4 SC2 fallback: emailEmptyStateReason=no-important-label renders exact copy', async () => {
    installAria(
      makePayload({
        email: [],
        emailEmptyStateReason: 'no-important-label',
        errors: {},
      }),
    );
    render(<BriefingScreen />);
    const fallback = await screen.findByTestId('email-sc2-fallback');
    expect(fallback.textContent).toBe(NO_IMPORTANT_LABEL_COPY);
    // Not an error bar, not the generic "No items today." placeholder.
    expect(screen.queryByTestId('section-error-email')).toBeNull();
    expect(screen.getByTestId('briefing-section-email').textContent).not.toContain(
      'No items today.',
    );
  });

  it('Case 10 — Regenerate button visible when briefing exists; click opens confirm modal; confirm calls briefingRegenerateToday and refreshes payload (UAT Gap 8)', async () => {
    const stub = installAria(makePayload());
    const fresh = makePayload({
      date: '2026-05-20',
      generatedAt: '2026-05-20T08:00:00.000Z',
      calendar: [{ id: 'cf', title: 'FRESH', why: 'just regenerated' }],
      email: [],
      news: [],
      route: 'FRONTIER',
    });
    stub.briefingRegenerateToday.mockResolvedValue(fresh);

    const user = userEvent.setup();
    render(<BriefingScreen />);

    const btn = await screen.findByTestId('briefing-regenerate-btn');
    expect(btn).toBeTruthy();
    // Modal not open initially.
    expect(screen.queryByTestId('briefing-regenerate-confirm')).toBeNull();

    await user.click(btn);
    await screen.findByTestId('briefing-regenerate-confirm');

    // Cancel path first.
    await user.click(screen.getByTestId('briefing-regenerate-cancel-btn'));
    expect(screen.queryByTestId('briefing-regenerate-confirm')).toBeNull();
    expect(stub.briefingRegenerateToday).not.toHaveBeenCalled();

    // Confirm path.
    await user.click(screen.getByTestId('briefing-regenerate-btn'));
    await screen.findByTestId('briefing-regenerate-confirm');
    await user.click(screen.getByTestId('briefing-regenerate-confirm-btn'));

    await waitFor(() => {
      expect(stub.briefingRegenerateToday).toHaveBeenCalledTimes(1);
    });
    // Payload swapped — the regenerated calendar item should appear.
    await waitFor(() => {
      expect(screen.getByTestId('calendar-item-cf')).toBeTruthy();
    });
  });

  it('Case 11 — Regenerate error path surfaces inline alert (UAT Gap 8)', async () => {
    const stub = installAria(makePayload());
    stub.briefingRegenerateToday.mockResolvedValue({ ok: false, error: 'db-locked' });

    const user = userEvent.setup();
    render(<BriefingScreen />);
    await user.click(await screen.findByTestId('briefing-regenerate-btn'));
    await user.click(screen.getByTestId('briefing-regenerate-confirm-btn'));

    const alert = await screen.findByTestId('briefing-regenerate-error');
    expect(alert.textContent).toContain('db-locked');
  });

  it('Case 9 — empty SectionEmail with no unread mail: renders generic "No items today." placeholder', async () => {
    installAria(makePayload({ email: [], emailEmptyStateReason: undefined, errors: {} }));
    render(<BriefingScreen />);
    await screen.findByTestId('briefing-section-email');
    expect(screen.queryByTestId('email-sc2-fallback')).toBeNull();
    expect(screen.getByTestId('briefing-section-email').textContent).toContain(
      'No items today.',
    );
  });
});
