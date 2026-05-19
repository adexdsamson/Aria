import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MEETING_BOT_BLOCKLIST } from '../../src/main/transcripts/no-bot-guard';

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else out.push(full);
  }
  return out;
}

describe('MEET-06 no meeting bot imports', () => {
  it('keeps production source free of bot/recording integrations', () => {
    const allow = join('src', 'main', 'transcripts', 'no-bot-guard.ts');
    const hits = files(join(process.cwd(), 'src'))
      .filter((file) => /\.(ts|tsx|js|mjs|json)$/.test(file))
      .filter((file) => !file.endsWith(allow))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8').toLowerCase();
        return MEETING_BOT_BLOCKLIST.filter((term) => text.includes(term.toLowerCase())).map((term) => ({ file, term }));
      });
    expect(hits).toEqual([]);
  });
});
