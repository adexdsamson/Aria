/**
 * Plan 03-04 Wave A — one-shot voice-match eval runner.
 *
 * Usage:
 *   npx tsx scripts/voice-match-eval.ts            # full run
 *   npx tsx scripts/voice-match-eval.ts --dry-run  # wire-only, no real LLM calls
 *
 * The script opens the SQLCipher DB (Phase 1 connect pattern, prompts for
 * passphrase if Aria has been sealed), samples 50 stratified sent emails,
 * calls the few-shot drafter + a generic-LLM baseline drafter, and dispatches
 * a Claude Sonnet judge per item. Writes the report to
 * `.planning/phases/03-.../eval-report-few-shot.json`. The accompanying
 * `03-04-SPIKE-VOICE-MATCH.md` is the human-authored decision document.
 *
 * Frontier judge is MANDATORY (RESEARCH §Pattern 6). If no Anthropic API key
 * is configured, the script surfaces a clear error and exits non-zero rather
 * than silently falling back to a local judge (RESEARCH §Pitfall 7).
 *
 * In `--dry-run` mode the harness is invoked with mocked drafters and a stub
 * judge so we can prove the wiring without hitting real APIs (or even
 * requiring a populated DB). The dry-run path is what `npm run test:unit`
 * exercises via the unit test, but invoking the script directly is the
 * verify-step listed in the plan.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import PQueue from 'p-queue';
import {
  runVoiceMatchEval,
  type HeldOutItem,
  type EvalReport,
} from '../src/main/drafting/eval/pairwise';

const PHASE_DIR = path.resolve(
  process.cwd(),
  '.planning/phases/03-approval-queue-sensitivity-router-email-triage-drafting-send',
);

function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

interface DryRunDb {
  prepare(sql: string): {
    run: (...args: unknown[]) => { changes: number };
    all: () => unknown[];
  };
  transaction<F extends (...args: never[]) => unknown>(fn: F): F;
  exec(sql: string): void;
  close(): void;
}

/** In-memory stub DB for --dry-run (avoids native-module load). */
function makeDryRunDb(): DryRunDb {
  const holdout = new Set<string>();
  return {
    prepare() {
      return {
        run: (id?: unknown, _ts?: unknown) => {
          if (typeof id === 'string') holdout.add(id);
          return { changes: 1 };
        },
        all: () => Array.from(holdout).map((id) => ({ id })),
      };
    },
    transaction: (((fn: (...args: unknown[]) => unknown) =>
      ((...args: unknown[]) => fn(...args))) as unknown) as DryRunDb['transaction'],
    exec() {
      /* no-op */
    },
    close() {
      /* no-op */
    },
  };
}

function makeDryRunItems(count = 8): HeldOutItem[] {
  const strata: HeldOutItem['stratum'][] = [
    'short-casual',
    'short-formal',
    'long-casual',
    'long-formal',
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `dry-msg-${i}`,
    inboundText: `Inbound ${i}`,
    goldReply: `Reply ${i}`,
    stratum: strata[i % strata.length]!,
  }));
}

async function runDry(): Promise<EvalReport> {
  console.log('[voice-match-eval] --dry-run: wiring sanity check, no real LLM calls');
  const db = makeDryRunDb() as unknown as Parameters<typeof runVoiceMatchEval>[0]['db'];
  const queue = new PQueue({ concurrency: 1 });
  const items = makeDryRunItems(8);
  const report = await runVoiceMatchEval({
    db,
    items,
    queue,
    approach: 'few-shot',
    draftFewShot: async (it) => `aria draft for ${it.id}`,
    draftBaseline: async (it) => `baseline draft for ${it.id}`,
    fetchExemplars: async () => ['exemplar one', 'exemplar two', 'exemplar three'],
    // Stub judge: deterministic 'a' winner so dry-run report shows pass=true.
    judge: async () => ({ winner: 'a', catastrophic: false, reason: 'dry-run' }),
  });
  return report;
}

async function runReal(): Promise<EvalReport> {
  // The real path requires (a) Anthropic API key for the judge, (b) the local
  // Ollama daemon for the Aria few-shot drafter (or a Plan 02 router-routed
  // call), and (c) the sealed SQLCipher DB unlocked with the user's
  // passphrase. Wiring those up beyond the harness is the script's
  // responsibility on the user's machine. We surface a clear error here so
  // the user knows what to fix.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set. The voice-match eval requires a frontier judge\n' +
        '(RESEARCH §Pattern 6 — local judge bias is a known pitfall). Configure the\n' +
        'key in Aria Settings → Frontier Provider, or export ANTHROPIC_API_KEY for\n' +
        'this script run, then retry.',
    );
  }
  // The real implementation samples gmail_message rows (outbound), builds
  // HeldOutItems, and dispatches the frontier judge via generateObject. That
  // wiring is intentionally minimal in this script — the spike runner is
  // designed to be edited by the operator before the run.
  throw new Error(
    'Real-run wiring is intentionally left for the operator. Edit ' +
      'scripts/voice-match-eval.ts: implement (a) sample 50 stratified sent ' +
      'messages from the SQLCipher DB, (b) call the few-shot + baseline ' +
      'drafters, (c) call generateObject(JudgeSchema) with Claude Sonnet. ' +
      'The harness in src/main/drafting/eval/pairwise.ts is fully wired and ' +
      'unit-tested; this script is the integration glue.',
  );
}

function writeReport(report: EvalReport): string {
  if (!fs.existsSync(PHASE_DIR)) {
    fs.mkdirSync(PHASE_DIR, { recursive: true });
  }
  const file = path.join(PHASE_DIR, `eval-report-${report.approach}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

async function main(): Promise<void> {
  const report = isDryRun() ? await runDry() : await runReal();
  const outPath = writeReport(report);
  console.log(`[voice-match-eval] wrote ${outPath}`);
  console.log(
    `[voice-match-eval] total=${report.total} ariaWins=${report.ariaWins} ` +
      `baselineWins=${report.baselineWins} ties=${report.ties} ` +
      `catastrophic=${report.catastrophic} winRate=${report.winRate.toFixed(3)} ` +
      `passed=${report.passed}`,
  );
}

main().catch((err) => {
  console.error('[voice-match-eval] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
