/**
 * Routing bench: how much work stays on the machine.
 *
 * For a local-first assistant this is the number that matters most, and it is
 * the one nobody publishes. Two modes:
 *
 *   offline — exercises the pure regex prefilter (classifySensitivity). No
 *             Ollama, no network, fully reproducible by anyone. Reports
 *             detection rate on prompts that must not leave the machine, the
 *             false-positive rate on benign prompts, and latency.
 *
 *   live    — exercises decideHybridRoute end to end with the real local
 *             classifier, and reports the three-way local/hybrid/frontier
 *             split. Requires a running Ollama daemon.
 *
 * Read the two offline numbers for what they are. `piiDetected` is the regex
 * prefilter doing its actual job, and a miss there is a privacy gap.
 * `categoryCaughtByRegex` is expected to be near zero: financial, legal and hr
 * are semantic categories the LLM classifier decides at stage 2, so this
 * number documents where responsibility sits rather than grading stage 1.
 */
import { classifySensitivity } from '../src/main/llm/classifier';
import { PROMPTS } from './lib/prompts';
import { summarise, timedSync, type LatencySummary } from './lib/stats';

export interface RoutingOfflineResult {
  mode: 'offline';
  prompts: number;
  /**
   * Of PII-bearing prompts, the fraction the regex prefilter flagged. This is
   * what stage 1 exists to catch and the only quality number it is fair to
   * hold it to.
   */
  piiDetected: number;
  /**
   * Of prompts that must stay local for CATEGORY reasons (financial, legal,
   * hr), the fraction the regex prefilter flagged. Expected to be low: these
   * are semantic judgements the LLM classifier makes at stage 2. Recorded so
   * the split of responsibility between stages is explicit, NOT as a pass/fail.
   */
  categoryCaughtByRegex: number;
  /** Of benign prompts, fraction the prefilter flagged anyway. */
  benignFalsePositive: number;
  latencyMs: LatencySummary;
}

/**
 * Why the live routing measurement did not produce numbers. Collapsing every
 * failure into "unreachable" was the original defect: a missing dependency, a
 * stopped daemon and a throwing classifier all printed the same line, so the
 * report told you nothing about what to fix.
 */
export interface RoutingLiveSkip {
  mode: 'skipped';
  reason:
    | 'import-failed'
    | 'ollama-unreachable'
    | 'ollama-timeout'
    | 'ollama-no-models'
    | 'decision-threw';
  detail: string;
  /** Models the probe saw, when it got far enough to look. */
  models?: string[];
}

export interface RoutingLiveResult {
  mode: 'live';
  prompts: number;
  split: { local: number; hybrid: number; frontier: number };
  /** local + hybrid: the share never sent to a frontier model in the clear. */
  neverSentRaw: number;
  agreementWithExpectation: number;
  latencyMs: LatencySummary;
  /**
   * Hardcoded stamp from sensitivityClassifier.ts. NOT derived from the model
   * that ran, which is why modelId below is recorded separately.
   */
  classifierVersion: string;
  /** The model the classifier actually resolved to for this run. */
  modelId: string | null;
  /** Everything the daemon had installed, for context. */
  installedModels: string[];
}

export function runRoutingOffline(repeats = 50): RoutingOfflineResult {
  const latencies: number[] = [];
  let localTotal = 0, localHit = 0;
  let piiTotal = 0, piiHit = 0;
  let benignTotal = 0, benignHit = 0;

  for (const p of PROMPTS) {
    let matched = false;
    for (let i = 0; i < repeats; i += 1) {
      const { ms, value } = timedSync(() => classifySensitivity(p.text));
      latencies.push(ms);
      matched = value.matched.length > 0;
    }
    if (p.expect === 'local') { localTotal += 1; if (matched) localHit += 1; }
    else if (p.expect === 'hybrid') { piiTotal += 1; if (matched) piiHit += 1; }
    else { benignTotal += 1; if (matched) benignHit += 1; }
  }

  return {
    mode: 'offline',
    prompts: PROMPTS.length,
    piiDetected: piiTotal === 0 ? Number.NaN : piiHit / piiTotal,
    categoryCaughtByRegex: localTotal === 0 ? Number.NaN : localHit / localTotal,
    benignFalsePositive: benignTotal === 0 ? Number.NaN : benignHit / benignTotal,
    latencyMs: summarise(latencies),
  };
}

/**
 * Live routing split. Probes the local stack with the app's own probeOllama()
 * before attempting anything, so a skip names the actual cause instead of
 * guessing. Never throws.
 */
export async function runRoutingLive(): Promise<RoutingLiveResult | RoutingLiveSkip> {
  let decideHybridRoute: typeof import('../src/main/llm/router').decideHybridRoute;
  let PQueue: typeof import('p-queue').default;
  let probeOllama: typeof import('../src/main/llm/ollamaProbe').probeOllama;
  let getActiveLocalModelId: typeof import('../src/main/llm/providers').getActiveLocalModelId;
  try {
    ({ decideHybridRoute } = await import('../src/main/llm/router'));
    ({ probeOllama } = await import('../src/main/llm/ollamaProbe'));
    ({ getActiveLocalModelId } = await import('../src/main/llm/providers'));
    PQueue = (await import('p-queue')).default;
  } catch (err) {
    return {
      mode: 'skipped',
      reason: 'import-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // Pre-flight against the real daemon. probeOllama never throws.
  const probe = await probeOllama();
  if (!probe.reachable) {
    return {
      mode: 'skipped',
      reason: probe.error === 'timeout' ? 'ollama-timeout' : 'ollama-unreachable',
      detail:
        probe.error === 'timeout'
          ? 'probeOllama timed out against http://127.0.0.1:11434'
          : 'nothing listening on http://127.0.0.1:11434 (ECONNREFUSED)',
    };
  }
  if (probe.models.length === 0) {
    return {
      mode: 'skipped',
      reason: 'ollama-no-models',
      detail: 'daemon is up but has no models pulled; the classifier has nothing to run',
      models: [],
    };
  }

  // Which model will actually answer. getLocalModel() resolves this same id,
  // so recording it here is what the run was measured against.
  let modelId: string | null = null;
  try {
    modelId = getActiveLocalModelId();
  } catch {
    modelId = null;
  }

  const queue = new PQueue({ concurrency: 1 });
  const latencies: number[] = [];
  const split = { local: 0, hybrid: 0, frontier: 0 };
  let agree = 0;
  let version = 'unknown';

  for (const p of PROMPTS) {
    const t0 = process.hrtime.bigint();
    let decision;
    try {
      decision = await decideHybridRoute({ prompt: p.text, queue });
    } catch (err) {
      return {
        mode: 'skipped',
        reason: 'decision-threw',
        detail: `prompt ${p.id}: ${err instanceof Error ? err.message : String(err)}`,
        models: probe.models,
      };
    }
    latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
    split[decision.routed] += 1;
    if (decision.routed === p.expect) agree += 1;
    version = decision.classifier_version;
  }

  const n = PROMPTS.length;
  return {
    mode: 'live',
    prompts: n,
    split: { local: split.local / n, hybrid: split.hybrid / n, frontier: split.frontier / n },
    neverSentRaw: (split.local + split.hybrid) / n,
    agreementWithExpectation: agree / n,
    latencyMs: summarise(latencies),
    classifierVersion: version,
    modelId,
    installedModels: probe.models,
  };
}
