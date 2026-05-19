/**
 * Plan 07-02 Task 2 — MANDATORY live Ollama /api/embed roundtrip (REVIEWS C13).
 *
 * The test FAILS LOUDLY (not silently skipped) when OLLAMA_AVAILABLE is unset
 * — that is the C13 contract. CI sets the env var and is responsible for
 * having an Ollama sidecar reachable. Local devs without Ollama hit the
 * actionable error in the describe block and know to start the daemon.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createEmbedClient } from '../../../src/main/rag/ollama-embeddings';

const AVAILABLE = process.env['OLLAMA_AVAILABLE'] === '1';

describe('Ollama /api/embed live roundtrip — REVIEWS C13', () => {
  if (!AVAILABLE) {
    it('REQUIRED — set OLLAMA_AVAILABLE=1 to run this test (Phase 7 REVIEWS C13)', () => {
      throw new Error(
        'set OLLAMA_AVAILABLE=1 to run this required test (Phase 7 REVIEWS C13 — no silent skip)',
      );
    });
    return;
  }

  it('embeds 2 inputs against the local Ollama daemon (768-dim, L2-norm≈1)', async () => {
    const client = createEmbedClient();
    const t0 = Date.now();
    const vectors = await client.embed(['hello', 'world']);
    const latency_ms = Date.now() - t0;
    expect(vectors.length).toBe(2);
    expect(vectors[0]!.length).toBe(768);
    expect(vectors[1]!.length).toBe(768);
    let s = 0;
    for (let i = 0; i < 768; i++) s += vectors[0]![i]! * vectors[0]![i]!;
    const l2norm = Math.sqrt(s);
    expect(l2norm).toBeCloseTo(1.0, 2);

    const evidenceDir = path.resolve(__dirname, '../../fixtures/rag');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, 'ollama-roundtrip-evidence.json'),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          modelId: client.modelId,
          dim: 768,
          l2norm,
          latency_ms,
        },
        null,
        2,
      ),
    );
  });
});
