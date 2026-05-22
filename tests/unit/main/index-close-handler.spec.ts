/**
 * Phase 12 / Plan 12-01 Task 2 — close-handler + window-all-closed decision
 * helper tests.
 *
 * We test the pure exported helpers (`decideCloseAction`,
 * `decideWindowAllClosed`) rather than the full BrowserWindow side-effect
 * path. The first-X toast is owned by Plan 12-03 — reserved as describe.todo.
 *
 * The whole purpose of these helpers is to make the close-handler branching
 * unit-testable without spinning up Electron — they encode the SC truths:
 *   - macOS red-X always hides unless Cmd-Q (appIsQuitting) is in flight
 *   - non-darwin X hides iff closeToTray=true AND !appIsQuitting
 *   - window-all-closed quits iff platform!==darwin AND closeToTray=false
 */
import { describe, it, expect } from 'vitest';
import {
  decideCloseAction,
  decideWindowAllClosed,
} from '../../../src/main/background/window-decisions';

describe('decideCloseAction — 6 cases', () => {
  const cases: Array<{
    name: string;
    platform: NodeJS.Platform;
    closeToTray: boolean;
    appIsQuitting: boolean;
    expected: 'hide' | 'destroy';
  }> = [
    {
      name: 'darwin + closeToTray=true + !quitting → hide (red-X hides)',
      platform: 'darwin',
      closeToTray: true,
      appIsQuitting: false,
      expected: 'hide',
    },
    {
      name: 'darwin + closeToTray=false + !quitting → still hide (Decision 5: dock always visible)',
      platform: 'darwin',
      closeToTray: false,
      appIsQuitting: false,
      expected: 'hide',
    },
    {
      name: 'darwin + quitting → destroy (Cmd-Q escape path)',
      platform: 'darwin',
      closeToTray: true,
      appIsQuitting: true,
      expected: 'destroy',
    },
    {
      name: 'win32 + closeToTray=true + !quitting → hide',
      platform: 'win32',
      closeToTray: true,
      appIsQuitting: false,
      expected: 'hide',
    },
    {
      name: 'win32 + closeToTray=false + !quitting → destroy (legacy behavior preserved)',
      platform: 'win32',
      closeToTray: false,
      appIsQuitting: false,
      expected: 'destroy',
    },
    {
      name: 'win32 + closeToTray=true + quitting → destroy (Quit tray item)',
      platform: 'win32',
      closeToTray: true,
      appIsQuitting: true,
      expected: 'destroy',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        decideCloseAction({
          platform: c.platform,
          closeToTray: c.closeToTray,
          appIsQuitting: c.appIsQuitting,
        }),
      ).toBe(c.expected);
    });
  }
});

describe('decideWindowAllClosed — 4 cases', () => {
  const cases: Array<{
    name: string;
    platform: NodeJS.Platform;
    closeToTray: boolean;
    expected: 'quit' | 'stay';
  }> = [
    {
      name: 'darwin + closeToTray=true → stay',
      platform: 'darwin',
      closeToTray: true,
      expected: 'stay',
    },
    {
      name: 'darwin + closeToTray=false → stay (macOS convention)',
      platform: 'darwin',
      closeToTray: false,
      expected: 'stay',
    },
    {
      name: 'win32 + closeToTray=true → stay (window hidden, process alive)',
      platform: 'win32',
      closeToTray: true,
      expected: 'stay',
    },
    {
      name: 'win32 + closeToTray=false → quit (legacy)',
      platform: 'win32',
      closeToTray: false,
      expected: 'quit',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(
        decideWindowAllClosed({
          platform: c.platform,
          closeToTray: c.closeToTray,
        }),
      ).toBe(c.expected);
    });
  }
});

describe.todo('first-X toast — owned by Plan 12-03');
