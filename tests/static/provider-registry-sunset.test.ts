import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

describe('provider registry kill-switch sunset', () => {
  it('removes ARIA_PROVIDER_REGISTRY from production source', () => {
    const matches = files(join(process.cwd(), 'src'))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes('ARIA_PROVIDER_REGISTRY'));

    expect(matches).toEqual([]);
  });
});
