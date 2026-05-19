import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('renderer component reachability', () => {
  it('keeps Task 4 account-management components mounted', () => {
    expect(read('src/renderer/features/settings/IntegrationsSection.tsx')).toMatch(/AddAccountModal/);
    expect(read('src/renderer/features/settings/IntegrationsSection.tsx')).toMatch(/AccountRow/);
    expect(read('src/renderer/features/settings/SettingsScreen.tsx')).toMatch(/IntegrationsSection/);
  });

  it('keeps StuckBadge reachable from the approval queue', () => {
    expect(read('src/renderer/features/approvals/ApprovalQueue.tsx')).toMatch(/StuckBadge/);
    expect(read('src/renderer/features/approvals/ApprovalsScreen.tsx')).toMatch(/ApprovalQueue/);
  });
});
