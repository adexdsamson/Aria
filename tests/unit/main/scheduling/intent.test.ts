/**
 * Plan 04-03 Task 1 — parseIntent unit tests.
 *
 * Stubs generateObject through deps.generateObjectFn + deps.model so no real
 * Ollama / frontier call is made.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseIntent, IntentRefusedError, IntentSchema } from '../../../../src/main/scheduling/intent';

function stubGenerate(obj: unknown) {
  return vi.fn(async () => ({ object: obj })) as unknown as Parameters<typeof parseIntent>[1] extends infer D
    ? D extends { generateObjectFn?: infer F }
      ? F
      : never
    : never;
}

describe('parseIntent', () => {
  it('refuses cancel commands with IntentRefusedError(cancel-not-in-v1)', async () => {
    const generateObjectFn = stubGenerate({
      action: 'cancel-unsupported',
    });
    await expect(
      parseIntent('cancel my 3pm', {
        model: {},
        generateObjectFn,
        nowIso: '2026-05-18T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'IntentRefusedError',
      code: 'cancel-not-in-v1',
    });
  });

  it('parses a move command into structured Intent', async () => {
    const generateObjectFn = stubGenerate({
      action: 'move',
      target: { eventRef: 'my 3pm' },
      when: { nlWhen: 'Thursday' },
    });
    const intent = await parseIntent('move my 3pm to Thursday', {
      model: {},
      generateObjectFn,
      nowIso: '2026-05-18T00:00:00.000Z',
    });
    expect(intent.action).toBe('move');
    expect(intent.target?.eventRef).toBe('my 3pm');
    expect(intent.when?.nlWhen).toBe('Thursday');
  });

  it('retries once on Zod failure then succeeds', async () => {
    let n = 0;
    const generateObjectFn = vi.fn(async () => {
      n++;
      if (n === 1) return { object: { action: 'not-a-real-action' } };
      return { object: { action: 'move', target: { eventRef: 'meeting' } } };
    }) as unknown as Parameters<typeof parseIntent>[1] extends infer D
      ? D extends { generateObjectFn?: infer F }
        ? F
        : never
      : never;
    const intent = await parseIntent('move the meeting', {
      model: {},
      generateObjectFn,
      nowIso: '2026-05-18T00:00:00.000Z',
    });
    expect(intent.action).toBe('move');
    expect(n).toBe(2);
  });

  it('throws IntentRefusedError(parse-failed) after final-attempt failure', async () => {
    const generateObjectFn = vi.fn(async () => ({
      object: { action: 'wrong' },
    })) as unknown as Parameters<typeof parseIntent>[1] extends infer D
      ? D extends { generateObjectFn?: infer F }
        ? F
        : never
      : never;
    await expect(
      parseIntent('move it', {
        model: {},
        generateObjectFn,
        nowIso: '2026-05-18T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'IntentRefusedError',
      code: 'parse-failed',
    });
  });

  it('IntentSchema accepts the canonical move shape', () => {
    const ok = IntentSchema.safeParse({
      action: 'move',
      target: { eventRef: 'my 3pm' },
      when: { nlWhen: 'Thursday' },
    });
    expect(ok.success).toBe(true);
  });

  it('redacts PII when routed=frontier before passing prompt to generateObject', async () => {
    const seenPrompts: string[] = [];
    const generateObjectFn = vi.fn(async (args: { prompt: string }) => {
      seenPrompts.push(args.prompt);
      return { object: { action: 'move', target: { eventRef: 'meeting' } } };
    }) as unknown as Parameters<typeof parseIntent>[1] extends infer D
      ? D extends { generateObjectFn?: infer F }
        ? F
        : never
      : never;
    await parseIntent('move my meeting with foo@example.com to 5pm', {
      model: {},
      generateObjectFn,
      routed: 'frontier',
      nowIso: '2026-05-18T00:00:00.000Z',
    });
    expect(seenPrompts[0]).not.toContain('foo@example.com');
    expect(seenPrompts[0]).toContain('<EMAIL>');
  });
});
