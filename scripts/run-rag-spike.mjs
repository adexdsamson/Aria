#!/usr/bin/env node
/**
 * Plan 07-01 Task 5 — one-shot CLI driver to run the chunking spike and write
 * .planning/phases/07-rag-q-a/07-SPIKE-CHUNKING.md.
 *
 * Run with:  node scripts/run-rag-spike.mjs
 *
 * Bypasses the vitest globalSetup native-binary swap (the desktop Electron
 * app holds the active binary while running, which makes vitest's setup file
 * fail on Windows EBUSY). The spike only touches pure-TS chunk-strategies
 * and the JSON fixture — no DB, no native binary needed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Use tsx loader to transpile TS on the fly.
register('tsx/esm', pathToFileURL(path.join(ROOT, 'node_modules/tsx/dist/loader.mjs')));

const spikeMod = await import(
  pathToFileURL(path.join(ROOT, 'src/main/rag/chunking-spike.ts')).href
);
const { runSpike, pickWinner, renderSpikeMarkdown } = spikeMod;

const fixturePath = path.join(ROOT, 'tests/fixtures/rag/eval-qa-set.json');
const outPath = path.join(ROOT, '.planning/phases/07-rag-q-a/07-SPIKE-CHUNKING.md');

const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const evalSet = { sources: raw.sources, questions: raw.questions };

const metrics = runSpike(evalSet);
const winner = pickWinner(metrics);
const md = renderSpikeMarkdown(metrics, winner, evalSet.questions.length, evalSet.sources.length);

fs.writeFileSync(outPath, md, 'utf8');
console.log(`Wrote ${outPath}`);
console.log(`Winner: ${winner.name}  recall@10=${(winner.recallAt10 * 100).toFixed(1)}%  MRR=${winner.mrr50.toFixed(3)}`);
for (const m of metrics) {
  console.log(`  ${m.name}: recall@10=${(m.recallAt10 * 100).toFixed(1)}%  MRR=${m.mrr50.toFixed(3)}  chunks=${m.totalChunks}`);
}
