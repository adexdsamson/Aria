/**
 * Plan 08-04 Task 5 Test 10 (L-2 round 2 parent-orphan guard).
 *
 * Asserts the /settings parent route exists in routes.tsx. UpdatesSection
 * is unreachable as a child if the parent route literal is removed —
 * Phase 4 MEMORY feedback_verifier_blindspot_ui_wiring documented the
 * sub-section orphan class; this closes the cheaper parent-orphan class.
 *
 * H-2 anchor pattern: per the plan, the literal lives in routes.tsx
 * (not App.tsx as the round-2 verify-grep initially assumed). We anchor
 * on the short invariant `path="/settings/*"` substring.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Plan 08-04 Test 10 — parent /settings route exists', () => {
  it('routes.tsx contains a path="/settings/*" Route literal', () => {
    const p = resolve(process.cwd(), 'src/renderer/app/routes.tsx');
    const text = readFileSync(p, 'utf8');
    // H-2 anchor — short invariant substring, NOT a date- or version-
    // decorated line.
    expect(text).toContain('path="/settings/*"');
  });

  it('SettingsScreen.tsx imports UpdatesSection (Phase 4 MEMORY guard)', () => {
    const p = resolve(
      process.cwd(),
      'src/renderer/features/settings/SettingsScreen.tsx',
    );
    const text = readFileSync(p, 'utf8');
    expect(text).toContain('UpdatesSection');
  });
});
