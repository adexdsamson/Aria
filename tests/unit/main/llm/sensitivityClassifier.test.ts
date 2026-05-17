/**
 * Plan 03-02 Task 1 — sensitivityClassifier unit tests.
 *
 * Covers:
 *   - happy path: LLM returns valid schema → that result flows through
 *   - regex-fallback path: LLM throws both attempts → synthesized result
 *   - schema rejection: SensitivitySchema enforces enums
 *   - CLASSIFIER_VERSION present
 *   - scheduler.queue.add invoked on every LLM dispatch
 *   - PII regression fixture (≥30 cases) — see fixture
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import PQueue from 'p-queue';
import {
  classify,
  CLASSIFIER_VERSION,
  SensitivitySchema,
  type SensitivityResult,
} from '../../../../src/main/llm/sensitivityClassifier';
import { classifySensitivity } from '../../../../src/main/llm/classifier';

function makeQueue(): InstanceType<typeof PQueue> {
  return new PQueue({ concurrency: 1 });
}

function fakeModel(): unknown {
  // Opaque placeholder — generateObjectFn injected, model arg never used.
  return { __fake: true };
}

describe('sensitivityClassifier', () => {
  it('CLASSIFIER_VERSION is a non-empty string', () => {
    expect(typeof CLASSIFIER_VERSION).toBe('string');
    expect(CLASSIFIER_VERSION.length).toBeGreaterThan(0);
  });

  it("classify('hello world') returns categories=['none'], severity='low'", async () => {
    const q = makeQueue();
    const genObj = vi.fn().mockResolvedValue({
      object: {
        categories: ['none'],
        severity: 'low',
        confidence: 0.9,
        rationale: 'no sensitive content',
      } satisfies SensitivityResult,
    });
    const r = await classify('hello world', q, {
      model: fakeModel(),
      generateObjectFn: genObj as never,
    });
    expect(r.categories).toEqual(['none']);
    expect(r.severity).toBe('low');
    expect(genObj).toHaveBeenCalledTimes(1);
  });

  it('routes generateObject through scheduler.queue.add (p-queue serialization)', async () => {
    const q = makeQueue();
    const addSpy = vi.spyOn(q, 'add');
    const genObj = vi.fn().mockResolvedValue({
      object: {
        categories: ['pii'],
        severity: 'med',
        confidence: 0.8,
        rationale: 'email present',
      } satisfies SensitivityResult,
    });
    await classify('contact foo@bar.com', q, {
      model: fakeModel(),
      generateObjectFn: genObj as never,
    });
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('LLM mocked to return valid schema → returns that', async () => {
    const q = makeQueue();
    const ret: SensitivityResult = {
      categories: ['pii', 'urgent'],
      severity: 'high',
      confidence: 0.95,
      rationale: 'urgent + email',
    };
    const genObj = vi.fn().mockResolvedValue({ object: ret });
    const r = await classify('URGENT: foo@bar.com', q, {
      model: fakeModel(),
      generateObjectFn: genObj as never,
    });
    expect(r).toEqual(ret);
  });

  it('LLM mocked to throw both attempts → regex-fallback {pii, high, 0.5, rationale contains LLM unavailable}', async () => {
    const q = makeQueue();
    const genObj = vi.fn().mockRejectedValue(new Error('ollama-down'));
    const r = await classify('please email foo@bar.com', q, {
      model: fakeModel(),
      generateObjectFn: genObj as never,
    });
    expect(r.categories).toEqual(['pii']);
    expect(r.severity).toBe('high');
    expect(r.confidence).toBe(0.5);
    expect(r.rationale.toLowerCase()).toContain('llm unavailable');
    expect(genObj).toHaveBeenCalledTimes(2); // 2 bounded retries
  });

  it('LLM fails on no-regex text → regex-fallback {none, low, 0.5}', async () => {
    const q = makeQueue();
    const genObj = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await classify('plain greeting', q, {
      model: fakeModel(),
      generateObjectFn: genObj as never,
    });
    expect(r.categories).toEqual(['none']);
    expect(r.severity).toBe('low');
    expect(r.confidence).toBe(0.5);
  });

  it('SensitivitySchema rejects unknown category', () => {
    const bad = {
      categories: ['totally-made-up'],
      severity: 'low',
      confidence: 0.5,
      rationale: '',
    };
    expect(() => SensitivitySchema.parse(bad)).toThrow();
  });

  it('SensitivitySchema rejects severity outside enum', () => {
    const bad = {
      categories: ['none'],
      severity: 'extreme',
      confidence: 0.5,
      rationale: '',
    };
    expect(() => SensitivitySchema.parse(bad)).toThrow();
  });

  it('SensitivitySchema rejects empty categories array', () => {
    const bad = {
      categories: [],
      severity: 'low',
      confidence: 0.5,
      rationale: '',
    };
    expect(() => SensitivitySchema.parse(bad)).toThrow();
  });

  it('PII regression fixture: ≥30 cases all pass against regex-only fallback', async () => {
    const fixturePath = path.resolve(
      __dirname,
      '../../../fixtures/pii-regression.json',
    );
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const cases = JSON.parse(raw) as Array<{
      id: string;
      text: string;
      expected: {
        categoriesIncludesAny: string[];
        minSeverity: 'low' | 'med' | 'high';
      };
    }>;
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const sevRank = { low: 0, med: 1, high: 2 } as const;

    for (const c of cases) {
      const q = makeQueue();
      // Force regex-only path so the fixture is deterministic.
      const genObj = vi.fn().mockRejectedValue(new Error('forced-regex-only'));
      const r = await classify(c.text, q, {
        model: fakeModel(),
        generateObjectFn: genObj as never,
      });
      const regexMatched = classifySensitivity(c.text).matched;
      // expected.categoriesIncludesAny ⊆ result.categories ∪ regexMatched-as-categories
      // (regex matched names map to 'pii' category at the classifier level)
      const union = new Set<string>([
        ...r.categories,
        ...(regexMatched.length > 0 ? ['pii'] : []),
        ...regexMatched, // also include raw names for tolerance
      ]);
      const anyHit = c.expected.categoriesIncludesAny.some((cat) =>
        union.has(cat),
      );
      expect(anyHit, `[${c.id}] expected one of ${JSON.stringify(c.expected.categoriesIncludesAny)} ; got ${JSON.stringify([...union])}`).toBe(true);
      expect(
        sevRank[r.severity] >= sevRank[c.expected.minSeverity],
        `[${c.id}] severity ${r.severity} < expected ${c.expected.minSeverity}`,
      ).toBe(true);
    }
  });
});
