/**
 * Report emitter: one JSON artefact for machines, one markdown table for the
 * README. Every table carries its own methodology footnote, so a figure cannot
 * be lifted out of context without the caveat travelling with it.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem } from 'node:os';
import type { RetrievalBenchResult } from '../retrieval.bench';
import type { RoutingOfflineResult, RoutingLiveResult, RoutingLiveSkip } from '../routing.bench';

export interface BenchReport {
  generatedAt: string;
  environment: {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    totalMemGb: number;
    nodeVersion: string;
  };
  retrieval: RetrievalBenchResult;
  routingOffline: RoutingOfflineResult;
  routingLive: RoutingLiveResult | RoutingLiveSkip | null;
}

const n2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
/** Latency formatter: keeps significant digits for sub-millisecond values. */
const ms = (x: number): string => {
  if (!Number.isFinite(x)) return 'n/a';
  if (x >= 1) return x.toFixed(2);
  if (x >= 0.01) return x.toFixed(3);
  return x.toExponential(1);
};
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');

export function collectEnvironment(): BenchReport['environment'] {
  const cpuList = cpus();
  return {
    platform: platform(),
    arch: arch(),
    cpuModel: cpuList[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpuList.length,
    totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    nodeVersion: process.version,
  };
}

export function renderMarkdown(r: BenchReport): string {
  const env = r.environment;
  const L: string[] = [];

  L.push('## Benchmarks');
  L.push('');
  L.push(`Generated ${r.generatedAt.slice(0, 10)} on ${env.platform}/${env.arch}, ${env.cpuCount} vCPU, ${env.totalMemGb} GB, Node ${env.nodeVersion}.`);
  L.push('Reproduce with `pnpm bench`. Every figure below comes from synthetic data committed to this repo, never from a user vault.');
  L.push('');

  // --- retrieval ---
  L.push('### Retrieval');
  L.push('');
  L.push(`Corpus: ${r.retrieval.corpus.totalChunks} chunks across ${r.retrieval.corpus.topics} topics, ${r.retrieval.queries} queries, ${r.retrieval.repeats} repeats per query. Vector backend: \`${r.retrieval.vectorBackend}\`.`);
  L.push('');
  L.push(`**Read recall@10 against its ceiling.** Each topic has ${r.retrieval.corpus.chunksPerTopic} relevant chunks and k is 10, so the maximum attainable recall@10 is ${(10 / r.retrieval.corpus.chunksPerTopic).toFixed(2)}. A figure near that is near-optimal, not poor. precision@10, MRR and nDCG@10 are the unbounded quality signals here.`);
  L.push('');
  L.push('| Query form | Strategy | recall@10 | precision@10 | MRR | nDCG@10 | p50 ms | p95 ms |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const s of r.retrieval.strategies) {
    L.push(`| ${s.queryForm} | ${s.strategy} | ${n2(s.recallAt10)} | ${n2(s.precisionAt10)} | ${n2(s.mrr)} | ${n2(s.ndcgAt10)} | ${ms(s.latencyMs.p50)} | ${ms(s.latencyMs.p95)} |`);
  }
  L.push('');
  L.push('**Query form matters more than strategy.** `natural` is a full question ("what is the status of the Q3 budget approval"); `keywords` is what someone types into a search box ("budget approval"). `buildFtsMatchExpr` joins every surviving token with FTS5 implicit AND, so a natural-language question only matches a chunk containing *all* of its words, stopwords included. On natural queries BM25 therefore returns nothing and hybrid silently degrades to vector-only, which is visible as identical vector and hybrid rows.');
  L.push('');
  L.push('> The offline embedder is a hashing vectorizer, not a neural model, so vector and hybrid quality here are a **floor** rather than a prediction of the shipped Ollama model. Vector latency excludes a real embedding call and is likewise a floor. The comparison between rows is the useful signal.');
  L.push('');

  // --- routing, offline ---
  const ro = r.routingOffline;
  L.push('### Privacy routing, prefilter');
  L.push('');
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Prompts in corpus | ${ro.prompts} |`);
  L.push(`| PII prompts caught by regex prefilter | ${pct(ro.piiDetected)} |`);
  L.push(`| Benign prompts flagged anyway | ${pct(ro.benignFalsePositive)} |`);
  L.push(`| Category prompts (financial/legal/hr) caught by regex | ${pct(ro.categoryCaughtByRegex)} |`);
  L.push(`| Classify latency p50 / p95 | ${ms(ro.latencyMs.p50)} / ${ms(ro.latencyMs.p95)} ms |`);
  L.push('');
  L.push('> Stage 1 is a regex PII prefilter, so PII detection is the number it should be held to. The last row is deliberately low: financial, legal and hr are semantic judgements made by the LLM classifier at stage 2, and this row documents where the responsibility sits rather than grading the regex. A PII miss, by contrast, is a privacy gap.');
  L.push('');

  // --- routing, live ---
  L.push('### Privacy routing, end to end');
  L.push('');
  const rl = r.routingLive;
  if (rl && rl.mode === 'live') {
    L.push(`| Metric | Value |`);
    L.push(`|---|---|`);
    L.push(`| Resolved fully on-device | ${pct(rl.split.local)} |`);
    L.push(`| Tokenised before frontier | ${pct(rl.split.hybrid)} |`);
    L.push(`| Sent to frontier in the clear | ${pct(rl.split.frontier)} |`);
    L.push(`| **Never sent raw off the machine** | **${pct(rl.neverSentRaw)}** |`);
    L.push(`| Agreement with the privacy contract | ${pct(rl.agreementWithExpectation)} |`);
    L.push(`| Decision latency p50 / p95 | ${ms(rl.latencyMs.p50)} / ${ms(rl.latencyMs.p95)} ms |`);
    L.push(`| Model that produced these decisions | \`${rl.modelId ?? 'unresolved'}\` |`);
    L.push(`| Classifier version stamp | \`${rl.classifierVersion}\` |`);
    if (rl.installedModels.length > 1) {
      L.push(`| Other models installed | ${rl.installedModels.filter((m) => m !== rl.modelId).join(', ')} |`);
    }
    const stampNames = rl.classifierVersion.replace(/^v\d+-/, '').replace(/-\d{4}-\d{2}$/, '');
    const stampBase = stampNames.split('-')[0] ?? '';
    if (rl.modelId && stampBase && !rl.modelId.toLowerCase().includes(stampBase.toLowerCase().replace(/\./g, ''))) {
      L.push('');
      L.push(`> **The version stamp does not describe the model that ran.** \`CLASSIFIER_VERSION\` is a hardcoded constant in \`sensitivityClassifier.ts\`, while the model is resolved at runtime by \`getActiveLocalModelId()\`. This run used \`${rl.modelId}\`, not the \`${stampNames}\` the stamp names. Read the split against the model row, not the stamp.`);
    }
  } else if (rl && rl.mode === 'skipped') {
    const fix: Record<RoutingLiveSkip['reason'], string> = {
      'import-failed': 'A dependency the live path needs will not load. If the detail mentions Electron, the bench does not actually need it: `pnpm bench:live` aliases it to bench/stubs/electron.ts. Otherwise reinstall the named package.',
      'ollama-unreachable': 'Start the Ollama daemon (`ollama serve`), then retry.',
      'ollama-timeout': 'The daemon answered too slowly. Check it is healthy, then retry.',
      'ollama-no-models': 'Pull the classifier model (`ollama pull <model>`), then retry.',
      'decision-threw': 'The daemon is up but the classifier call failed. See the detail line.',
    };
    L.push(`_Not measured. Reason: \`${rl.reason}\`._`);
    L.push('');
    L.push(`- **What happened:** ${rl.detail}`);
    L.push(`- **What fixes it:** ${fix[rl.reason]}`);
    if (rl.models && rl.models.length > 0) {
      L.push(`- **Models the probe saw:** ${rl.models.join(', ')}`);
    }
  } else {
    L.push('_Not attempted. Run `pnpm bench:live` to populate this table._');
  }
  L.push('');

  return L.join('\n');
}

export function writeReport(r: BenchReport, outDir = join(process.cwd(), 'bench', 'results')): {
  jsonPath: string;
  mdPath: string;
} {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'latest.json');
  const mdPath = join(outDir, 'latest.md');
  writeFileSync(jsonPath, `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderMarkdown(r)}\n`, 'utf8');
  return { jsonPath, mdPath };
}
