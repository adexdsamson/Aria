/**
 * Phase 12 / Plan 12-02 Task 1 — tray icons.ts unit spec.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  nativeImage: {
    createFromPath: (p: string) => ({ __path: p }),
  },
}));

import {
  loadTrayIcon,
  _resolveTrayIconPathForTests,
} from '../../../../src/main/tray/icons';

describe('loadTrayIcon path resolution', () => {
  it('win32 plain → tray-icon.ico', () => {
    const p = _resolveTrayIconPathForTests('plain', 'win32');
    expect(p).toMatch(/tray-icon\.ico$/);
  });

  it('win32 badged → tray-icon-badged.ico', () => {
    const p = _resolveTrayIconPathForTests('badged', 'win32');
    expect(p).toMatch(/tray-icon-badged\.ico$/);
  });

  it('darwin plain → tray-iconTemplate.png', () => {
    const p = _resolveTrayIconPathForTests('plain', 'darwin');
    expect(p).toMatch(/tray-iconTemplate\.png$/);
  });

  it('darwin badged → tray-iconBadgedTemplate.png', () => {
    const p = _resolveTrayIconPathForTests('badged', 'darwin');
    expect(p).toMatch(/tray-iconBadgedTemplate\.png$/);
  });

  it('linux falls back to Template PNGs (mac path)', () => {
    const p = _resolveTrayIconPathForTests('plain', 'linux');
    expect(p).toMatch(/tray-iconTemplate\.png$/);
  });

  it('loadTrayIcon returns a NativeImage stub from createFromPath', () => {
    const img = loadTrayIcon('plain', 'win32') as { __path: string };
    expect(img.__path).toMatch(/tray-icon\.ico$/);
  });
});
