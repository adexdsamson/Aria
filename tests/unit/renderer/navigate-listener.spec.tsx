/**
 * Phase 12 / Plan 12-03 Task 3 — Tests for the aria:navigate listener.
 *
 * Covers:
 *   - AppShellNavigateListener subscribes via window.aria.onNavigate at mount
 *   - Allowlisted paths (/briefing, /approvals) trigger react-router navigate
 *   - Non-allowlisted paths are ignored (logged but not navigated)
 *   - Unsubscribes on unmount
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock react-router-dom useNavigate
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useNavigate: () => mockNavigate,
  };
});

// ---------------------------------------------------------------------------
// window.aria.onNavigate mock — captures the callback
// ---------------------------------------------------------------------------

let capturedOnNavigateCb: ((path: string) => void) | null = null;
const mockUnsubscribe = vi.fn();

// ---------------------------------------------------------------------------
// SUT — import after mocks are defined
// ---------------------------------------------------------------------------

import { AppShellNavigateListener } from '../../../src/renderer/app/App';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderInRouter() {
  return render(
    <MemoryRouter>
      <AppShellNavigateListener />
    </MemoryRouter>,
  );
}

function setupAriaMock() {
  capturedOnNavigateCb = null;
  mockUnsubscribe.mockClear();
  const onNavigate = vi.fn().mockImplementation((cb: (path: string) => void) => {
    capturedOnNavigateCb = cb;
    return mockUnsubscribe;
  });
  // Inject on window
  Object.assign(window, {
    aria: {
      onNavigate,
      onboardingStatus: vi.fn().mockResolvedValue({ sealed: true, unlocked: false }),
    },
  });
  return onNavigate;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockNavigate.mockClear();
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppShellNavigateListener', () => {
  it('subscribes via window.aria.onNavigate on mount', () => {
    const onNavigate = setupAriaMock();
    renderInRouter();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('routes to /briefing when allowlisted path received', async () => {
    setupAriaMock();
    renderInRouter();
    expect(capturedOnNavigateCb).not.toBeNull();
    await act(async () => {
      capturedOnNavigateCb!('/briefing');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/briefing');
  });

  it('routes to /approvals when allowlisted path received', async () => {
    setupAriaMock();
    renderInRouter();
    await act(async () => {
      capturedOnNavigateCb!('/approvals');
    });
    expect(mockNavigate).toHaveBeenCalledWith('/approvals');
  });

  it('does NOT navigate for non-allowlisted path /settings', async () => {
    setupAriaMock();
    renderInRouter();
    await act(async () => {
      capturedOnNavigateCb!('/settings');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does NOT navigate for empty path', async () => {
    setupAriaMock();
    renderInRouter();
    await act(async () => {
      capturedOnNavigateCb!('');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls unsubscribe on unmount', async () => {
    setupAriaMock();
    const { unmount } = renderInRouter();
    await act(async () => {
      unmount();
    });
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
