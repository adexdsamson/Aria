/**
 * Phase 9 Plan 02 Task 1 — Topbar pathname → title-pair tests + ⌘K bridge.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Topbar } from '../Topbar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Topbar />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Topbar', () => {
  it('renders briefing title and morning eyebrow at /briefing', () => {
    renderAt('/briefing');
    expect(screen.getByTestId('aria-topbar-title')).toHaveTextContent("Today's Briefing");
    expect(screen.getByTestId('aria-topbar-eyebrow').textContent).toContain('The Morning');
  });

  it('renders recap title at /recap', () => {
    renderAt('/recap');
    expect(screen.getByTestId('aria-topbar-title')).toHaveTextContent('The week in brief');
  });

  it('renders routing-log diagnostics title', () => {
    renderAt('/routing-log');
    expect(screen.getByTestId('aria-topbar-eyebrow')).toHaveTextContent('Diagnostics');
    expect(screen.getByTestId('aria-topbar-title')).toHaveTextContent('Routing log');
  });

  it('falls back to briefing title for unknown routes', () => {
    renderAt('/unknown');
    expect(screen.getByTestId('aria-topbar-title')).toHaveTextContent("Today's Briefing");
  });

  it('clicking the ⌘K button dispatches aria:cmdk-toggle', () => {
    const handler = vi.fn();
    window.addEventListener('aria:cmdk-toggle', handler);
    renderAt('/briefing');
    fireEvent.click(screen.getByTestId('aria-topbar-cmdk'));
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('aria:cmdk-toggle', handler);
  });
});
