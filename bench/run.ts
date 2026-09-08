/**
 * Bench entry point.
 *
 *   pnpm bench          offline only, no Ollama, reproducible by anyone
 *   pnpm bench:live     also runs the end-to-end routing split (needs Ollama)
 *   pnpm bench -- --quick   smaller corpus and fewer repeats, for a fast loop
 *
 * Writes bench/results/latest.json and bench/results/latest.md, and prints the
 * markdown so it can be pasted straight into the README.
 */
import { runRetrievalBench } from './retrieval.bench';
import { runRoutingLive, runRoutingOffline } from './routing.bench';
import { collectEnvironment, renderMarkdown, writeReport, type BenchReport } from './lib/report';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  const quick = argv.includes('--quick');

  const chunksPerTopic = quick ? 10 : 40;
  const distractors = quick ? 50 : 200;
  const repeats = quick ? 5 : 20;

  process.stderr.write(`bench: retrieval (chunksPerTopic=${chunksPerTopic}, repeats=${repeats})\n`);
  const retrieval = await runRetrievalBench({ chunksPerTopic, distractors, repeats });

  process.stderr.write('bench: routing prefilter\n');
  const routingOffline = runRoutingOffline(quick ? 10 : 50);

  let routingLive: Awaited<ReturnType<typeof runRoutingLive>> | null = null;
  if (live) {
    process.stderr.write('bench: routing end-to-end (requires Ollama)\n');
    routingLive = await runRoutingLive();
    if (routingLive.mode === 'skipped') {
      process.stderr.write(`bench: live routing NOT measured [${routingLive.reason}] ${routingLive.detail}\n`);
    }
  }

  const report: BenchReport = {
    generatedAt: new Date().toISOString(),
    environment: collectEnvironment(),
    retrieval,
    routingOffline,
    routingLive,
  };

  const { jsonPath, mdPath } = writeReport(report);
  process.stdout.write(`${renderMarkdown(report)}\n`);
  process.stderr.write(`\nbench: wrote ${jsonPath}\nbench: wrote ${mdPath}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`bench failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
