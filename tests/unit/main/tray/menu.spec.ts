/**
 * Phase 12 / Plan 12-02 Task 1 — buildContextMenu unit spec.
 *
 * We mock electron.Menu.buildFromTemplate to capture the raw template so
 * we can assert structure + enable-state without a live Menu instance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let lastTemplate: any[] = [];
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: any[]) => {
      lastTemplate = template;
      return { __template: template };
    },
  },
}));

import { buildContextMenu, type TrayMenuDeps } from '../../../../src/main/tray/menu';
import type { DbHolder } from '../../../../src/main/ipc/onboarding';

function makeDeps(opts: {
  dbOpen?: boolean;
  connected?: { gmail?: boolean; calendar?: boolean; todoist?: boolean };
} = {}): TrayMenuDeps {
  const dbHolder = {
    db: (opts.dbOpen ?? true) ? ({} as never) : null,
    isOpen: opts.dbOpen ?? true,
    set: () => undefined,
    close: () => undefined,
  } as DbHolder;
  return {
    getMainWindow: () => null,
    dbHolder,
    connected: {
      gmail: opts.connected?.gmail ?? true,
      calendar: opts.connected?.calendar ?? true,
      todoist: opts.connected?.todoist ?? true,
    },
    invokeChannel: vi.fn(),
    navigate: vi.fn(),
    beginQuit: vi.fn(),
    quit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
  };
}

describe('buildContextMenu', () => {
  beforeEach(() => {
    lastTemplate = [];
  });

  it('produces 6 top-level items (incl. separator) in the documented order', () => {
    buildContextMenu(makeDeps());
    const labels = lastTemplate.map((i) => i.label ?? i.type);
    expect(labels).toEqual([
      'Show Aria',
      'Generate briefing now',
      'Sync now',
      'Open approvals',
      'separator',
      'Quit Aria',
    ]);
  });

  it('Sync now submenu has Gmail / Calendar / Todoist', () => {
    buildContextMenu(makeDeps());
    const sync = lastTemplate.find((i) => i.label === 'Sync now');
    expect(sync.submenu.map((s: any) => s.label)).toEqual(['Gmail', 'Calendar', 'Todoist']);
  });

  it('Generate briefing now is disabled when db is null', () => {
    buildContextMenu(makeDeps({ dbOpen: false }));
    const item = lastTemplate.find((i) => i.label === 'Generate briefing now');
    expect(item.enabled).toBe(false);
    expect(item.toolTip).toBe('Unlock Aria first');
  });

  it('Gmail sync item respects both dbOpen AND connected.gmail', () => {
    buildContextMenu(makeDeps({ dbOpen: true, connected: { gmail: false } }));
    const gmail = lastTemplate.find((i) => i.label === 'Sync now').submenu[0];
    expect(gmail.enabled).toBe(false);
  });

  it('all sync items disabled when db sealed even if provider connected', () => {
    buildContextMenu(makeDeps({ dbOpen: false, connected: { gmail: true, calendar: true, todoist: true } }));
    const submenu = lastTemplate.find((i) => i.label === 'Sync now').submenu;
    for (const item of submenu) expect(item.enabled).toBe(false);
  });

  it('Quit Aria calls beginQuit then quit', () => {
    const deps = makeDeps();
    buildContextMenu(deps);
    const quit = lastTemplate.find((i) => i.label === 'Quit Aria');
    quit.click();
    expect(deps.beginQuit).toHaveBeenCalledOnce();
    expect(deps.quit).toHaveBeenCalledOnce();
  });

  it('Generate briefing now click invokes the BRIEFING_GENERATE_NOW channel', () => {
    const deps = makeDeps();
    buildContextMenu(deps);
    const item = lastTemplate.find((i) => i.label === 'Generate briefing now');
    item.click();
    expect(deps.invokeChannel).toHaveBeenCalledWith('aria:briefing:generate-now');
  });

  it('Open approvals click navigates to /approvals', () => {
    const deps = makeDeps();
    buildContextMenu(deps);
    const item = lastTemplate.find((i) => i.label === 'Open approvals');
    item.click();
    expect(deps.navigate).toHaveBeenCalledWith('/approvals');
  });
});
