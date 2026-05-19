import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('calendar route reachability', () => {
  it('wires UnifiedCalendarScreen into route table and side nav', () => {
    const routes = readFileSync(join(root, 'src/renderer/app/routes.tsx'), 'utf8');
    const nav = readFileSync(join(root, 'src/renderer/components/SideNav.tsx'), 'utf8');

    expect(routes).toContain('UnifiedCalendarScreen');
    expect(routes).toContain('path="/calendar"');
    expect(nav).toContain("to: '/calendar'");
    expect(nav).toContain('sidenav-calendar');
  });
});
