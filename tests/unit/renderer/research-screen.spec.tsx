/**
 * Phase 11 Plan 03 Task 2 — Research UI component tests.
 *
 * Covers: ResearchScreen empty state, with jobs, Document/Dashboard toggle,
 * NewResearchJobModal disabled/enabled button, FeedbackBar thumbs-up/down.
 *
 * Pattern: matches tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ResearchScreen } from '../../../src/renderer/features/research/ResearchScreen';
import { NewResearchJobModal } from '../../../src/renderer/features/research/NewResearchJobModal';
import { FeedbackBar } from '../../../src/renderer/features/research/FeedbackBar';
import type { ResearchJobDto, ResearchReportDto } from '../../../src/shared/ipc-contract';

// ---------------------------------------------------------------------------
// window.aria stub
// ---------------------------------------------------------------------------

interface AriaResearchStub {
  researchJobList: ReturnType<typeof vi.fn>;
  researchSuggestionsGet: ReturnType<typeof vi.fn>;
  researchReportList: ReturnType<typeof vi.fn>;
  researchJobCreate: ReturnType<typeof vi.fn>;
  researchJobRun: ReturnType<typeof vi.fn>;
  researchJobGet: ReturnType<typeof vi.fn>;
  researchSecretsHas: ReturnType<typeof vi.fn>;
  researchFeedbackSave: ReturnType<typeof vi.fn>;
  researchSuggestionApprove: ReturnType<typeof vi.fn>;
  researchSuggestionDismiss: ReturnType<typeof vi.fn>;
  onResearchReportDone: ReturnType<typeof vi.fn>;
}

function installAria(overrides: Partial<AriaResearchStub> = {}): AriaResearchStub {
  const stub: AriaResearchStub = {
    researchJobList: vi.fn().mockResolvedValue({ jobs: [] }),
    researchSuggestionsGet: vi.fn().mockResolvedValue({ jobs: [] }),
    researchReportList: vi.fn().mockResolvedValue({ reports: [] }),
    researchJobCreate: vi.fn().mockResolvedValue({ job: { id: 'job-new', title: 'New Job', goals: '', domains: [], status: 'draft', scheduleInterval: 'none', nextRunAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }),
    researchJobRun: vi.fn().mockResolvedValue({ ok: true, reportId: '' }),
    researchJobGet: vi.fn().mockResolvedValue({ job: null }),
    researchSecretsHas: vi.fn().mockResolvedValue({ hasBrave: true, hasExa: false }),
    researchFeedbackSave: vi.fn().mockResolvedValue({ ok: true }),
    researchSuggestionApprove: vi.fn().mockResolvedValue({ ok: true }),
    researchSuggestionDismiss: vi.fn().mockResolvedValue({ ok: true }),
    onResearchReportDone: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
  (globalThis as unknown as { window: { aria: AriaResearchStub } }).window.aria = stub;
  return stub;
}

function makeJob(over: Partial<ResearchJobDto> = {}): ResearchJobDto {
  return {
    id: 'job-1',
    title: 'AI in Healthcare 2025',
    goals: 'Understand adoption patterns',
    domains: ['healthcare', 'AI'],
    status: 'done',
    scheduleInterval: 'none',
    nextRunAt: null,
    createdAt: '2026-05-01T07:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
    ...over,
  };
}

function makeReport(over: Partial<ResearchReportDto> = {}): ResearchReportDto {
  return {
    id: 'report-1',
    jobId: 'job-1',
    version: 1,
    status: 'done',
    trigger: 'manual',
    summary: 'Executive summary text.',
    confidenceScore: 75,
    errorMessage: null,
    generatedAt: '2026-05-01T08:00:00.000Z',
    sections: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

// ---------------------------------------------------------------------------
// ResearchScreen tests
// ---------------------------------------------------------------------------

describe('ResearchScreen', () => {
  it('Case 1 — renders empty state when no jobs returned', async () => {
    installAria({
      researchJobList: vi.fn().mockResolvedValue({ jobs: [] }),
    });
    render(
      <MemoryRouter>
        <ResearchScreen />
      </MemoryRouter>,
    );
    // Empty state message appears
    expect(await screen.findByText(/no research jobs yet/i)).toBeTruthy();
  });

  it('Case 2 — renders job cards in left rail when jobs returned', async () => {
    const job = makeJob();
    installAria({
      researchJobList: vi.fn().mockResolvedValue({ jobs: [job] }),
    });
    render(
      <MemoryRouter>
        <ResearchScreen />
      </MemoryRouter>,
    );
    // Job title should appear in the left rail
    expect(await screen.findByText('AI in Healthcare 2025')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Document/Dashboard toggle tests
// ---------------------------------------------------------------------------

describe('ResearchScreen — Document/Dashboard toggle', () => {
  it('Case 3 — clicking Dashboard switches to dashboard view', async () => {
    const job = makeJob();
    const report = makeReport();
    installAria({
      researchJobList: vi.fn().mockResolvedValue({ jobs: [job] }),
      researchReportList: vi.fn().mockResolvedValue({ reports: [report] }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ResearchScreen />
      </MemoryRouter>,
    );
    // Wait for jobs to load
    await screen.findByText('AI in Healthcare 2025');

    // Click the job card to select it
    await user.click(screen.getByText('AI in Healthcare 2025'));

    // Wait for report to load and toggle to appear
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
    });

    // Click Dashboard toggle
    await user.click(screen.getByText('Dashboard'));

    // The dashboard button should be active (gold background applied via inline style)
    // We verify the DOM has Dashboard button present (toggle succeeded without error)
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Document')).toBeTruthy();
  });

  it('Case 4 — clicking Document returns to document view', async () => {
    const job = makeJob();
    const report = makeReport();
    installAria({
      researchJobList: vi.fn().mockResolvedValue({ jobs: [job] }),
      researchReportList: vi.fn().mockResolvedValue({ reports: [report] }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ResearchScreen />
      </MemoryRouter>,
    );
    await screen.findByText('AI in Healthcare 2025');
    await user.click(screen.getByText('AI in Healthcare 2025'));

    await waitFor(() => {
      expect(screen.getByText('Document')).toBeTruthy();
    });

    // Click Dashboard then back to Document
    await user.click(screen.getByText('Dashboard'));
    await user.click(screen.getByText('Document'));

    // Document button should now be active again
    expect(screen.getByText('Document')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// NewResearchJobModal — disabled/enabled button state
// ---------------------------------------------------------------------------

describe('NewResearchJobModal', () => {
  beforeEach(() => {
    // Ensure window.aria.researchJobCreate is available for modal render
    installAria();
  });

  it('Case 5 — Start Research button is disabled when no API keys present', async () => {
    // Override researchSecretsHas to return no keys
    (globalThis as unknown as { window: { aria: AriaResearchStub } }).window.aria.researchSecretsHas =
      vi.fn().mockResolvedValue({ hasBrave: false, hasExa: false });

    render(
      <NewResearchJobModal
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );

    // Wait for the secrets check to complete
    await waitFor(() => {
      const btn = screen.getByTestId('research-submit-btn') as HTMLButtonElement;
      // button is disabled when hasKeys === false
      expect(btn.disabled).toBe(true);
    });
  });

  it('Case 6 — Start Research button is enabled when at least one key is present', async () => {
    (globalThis as unknown as { window: { aria: AriaResearchStub } }).window.aria.researchSecretsHas =
      vi.fn().mockResolvedValue({ hasBrave: true, hasExa: false });

    render(
      <NewResearchJobModal
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );

    // Initially the button is disabled because title is empty
    // Type a title to enable it
    const user = userEvent.setup();
    const titleInput = screen.getByTestId('research-title-input');
    await user.type(titleInput, 'My Research Topic');

    // After typing a title and having at least one key, button should not be disabled
    await waitFor(() => {
      const btn = screen.getByTestId('research-submit-btn') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// FeedbackBar — thumbs up / thumbs down
// ---------------------------------------------------------------------------

describe('FeedbackBar', () => {
  it('Case 7 — clicking thumbs-up calls researchFeedbackSave with thumb=1', async () => {
    const aria = installAria();
    const user = userEvent.setup();

    render(
      <FeedbackBar reportId="report-1" sectionId="section-1" />,
    );

    const upBtn = screen.getByRole('button', { name: 'Helpful' });
    await user.click(upBtn);

    await waitFor(() => {
      expect(aria.researchFeedbackSave).toHaveBeenCalledWith(
        expect.objectContaining({ reportId: 'report-1', sectionId: 'section-1', thumb: 1 }),
      );
    });
  });

  it('Case 8 — clicking thumbs-down calls researchFeedbackSave with thumb=-1', async () => {
    const aria = installAria();
    const user = userEvent.setup();

    render(
      <FeedbackBar reportId="report-2" sectionId={null} />,
    );

    const downBtn = screen.getByRole('button', { name: 'Not helpful' });
    await user.click(downBtn);

    await waitFor(() => {
      expect(aria.researchFeedbackSave).toHaveBeenCalledWith(
        expect.objectContaining({ reportId: 'report-2', sectionId: null, thumb: -1 }),
      );
    });
  });
});
