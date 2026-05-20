/**
 * Plan 08.1-03 Task 5 — static reachability ratchet.
 *
 * Phase 4 LEARNINGS feedback_verifier_blindspot_ui_wiring documented that
 * components which exist + have unit tests but are not imported from any
 * Screen are unreachable. This file is a grep-level guard against that
 * specific class of bug for the 08.1-03 paywall UX surfaces.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('Plan 08.1-03 — Settings & route reachability', () => {
  it('SettingsScreen imports + mounts SubscriptionSection', () => {
    const src = read('src/renderer/features/settings/SettingsScreen.tsx');
    expect(src).toMatch(/import\s+\{\s*SubscriptionSection\s*\}/);
    expect(src).toMatch(/<SubscriptionSection/);
  });

  it('SettingsScreen imports + mounts RestoreLicenseSection', () => {
    const src = read('src/renderer/features/settings/SettingsScreen.tsx');
    expect(src).toMatch(/import\s+\{\s*RestoreLicenseSection\s*\}/);
    expect(src).toMatch(/<RestoreLicenseSection/);
  });

  it('App.tsx wraps the router in EntitlementProvider', () => {
    const src = read('src/renderer/app/App.tsx');
    expect(src).toMatch(/EntitlementProvider/);
    expect(src).toMatch(/<EntitlementProvider/);
  });

  it('App.tsx mounts <TrialBanner /> as a sibling of routed content', () => {
    const src = read('src/renderer/app/App.tsx');
    expect(src).toMatch(/TrialBanner/);
    expect(src).toMatch(/<TrialBanner/);
  });

  it('routes.tsx references PaywallScreen (centralized locked-state guard)', () => {
    const src = read('src/renderer/app/routes.tsx');
    expect(src).toMatch(/PaywallScreen/);
  });
});
