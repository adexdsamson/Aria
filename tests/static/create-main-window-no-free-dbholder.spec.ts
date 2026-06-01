/**
 * Regression ratchet — quick task 260601-nxh.
 *
 * Production crash: `ReferenceError: dbHolder is not defined` thrown from the
 * BrowserWindow `close` handler in `createMainWindow()`. Root cause: the
 * close handler referenced `dbHolder`, which is a local `const` declared inside
 * `bootstrap()` — NOT in `createMainWindow`'s scope. esbuild (electron-vite)
 * strips types without typechecking, so the free identifier shipped and only
 * threw at runtime on the first Windows close-to-tray.
 *
 * The fix injects the DB via a `dbReader: () => Db | null` closure param,
 * mirroring the existing `closeToTrayReader` pattern. This ratchet ensures the
 * fix never silently regresses: `createMainWindow`'s body must never reference
 * `dbHolder` directly — it only exists in `bootstrap()`'s scope.
 *
 * Comments are stripped before scanning so doc-comments mentioning `dbHolder`
 * (like this header, or the closeToTrayReader comment in index.ts) don't trip
 * the ratchet — only executable code does.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const INDEX_TS = path.resolve(__dirname, '..', '..', 'src', 'main', 'index.ts');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Extract the body of `function createMainWindow(...) { ... }` by balancing
 * braces from the first `{` after the signature to its matching `}`.
 */
function extractCreateMainWindowBody(src: string): string {
  const sigIdx = src.indexOf('function createMainWindow');
  expect(sigIdx, 'createMainWindow function not found in src/main/index.ts').toBeGreaterThan(-1);
  const openIdx = src.indexOf('{', sigIdx);
  expect(openIdx, 'createMainWindow opening brace not found').toBeGreaterThan(-1);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  throw new Error('createMainWindow body: unbalanced braces');
}

describe('createMainWindow — no free dbHolder reference (quick 260601-nxh)', () => {
  it('createMainWindow body must not reference `dbHolder` (it is out of scope there)', () => {
    const body = stripComments(fs.readFileSync(INDEX_TS, 'utf8'));
    const fnBody = extractCreateMainWindowBody(body);
    expect(
      fnBody.includes('dbHolder'),
      'createMainWindow references `dbHolder`, which is local to bootstrap() and ' +
        'out of scope — this re-introduces the production ReferenceError. Inject the ' +
        'DB via the `dbReader` closure param instead.',
    ).toBe(false);
  });
});
