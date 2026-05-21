/**
 * Plan 10-02 Task 1 — answer-router tests (extended for folder sensitivity).
 */
import { describe, it, expect } from 'vitest';
import { routeAnswer } from './answer-router';
import type { RouterChunk } from './answer-router';

function makeChunk(overrides: Partial<RouterChunk> = {}): RouterChunk {
  return {
    id: 'chunk:1',
    text: 'some text',
    sourceKind: 'email',
    sourceId: 'src:1',
    title: 'Test',
    sensitivity: null,
    ...overrides,
  };
}

describe('routeAnswer — folder sensitivity', () => {
  it('folder:high alone returns LOCAL', () => {
    const result = routeAnswer('q', [makeChunk({ sensitivity: 'folder:high', sourceKind: 'folder' })]);
    expect(result.route).toBe('LOCAL');
    expect(result.reason).toBe('rag-answer:sensitivity-folder:high');
  });

  it('folder:low alone returns FRONTIER', () => {
    const result = routeAnswer('q', [makeChunk({ sensitivity: 'folder:low', sourceKind: 'folder' })]);
    expect(result.route).toBe('FRONTIER');
  });

  it('hybrid set with folder:high forces LOCAL', () => {
    const result = routeAnswer('q', [
      makeChunk({ sensitivity: 'folder:high', sourceKind: 'folder' }),
      makeChunk({ sensitivity: null, sourceKind: 'email' }),
    ]);
    expect(result.route).toBe('LOCAL');
  });

  it('null sensitivity is fail-closed LOCAL', () => {
    const result = routeAnswer('q', [makeChunk({ sensitivity: null })]);
    expect(result.route).toBe('LOCAL');
    expect(result.reason).toBe('rag-answer:sensitivity-null:fail-closed');
  });

  it('pure non-sensitive email chunks return FRONTIER', () => {
    const result = routeAnswer('q', [makeChunk({ sensitivity: 'none', sourceKind: 'email' })]);
    expect(result.route).toBe('FRONTIER');
  });
});

// TypeScript compile-time check: RouterChunk accepts sourceKind:'folder'.
// If chunk-types.ts SourceKind no longer includes 'folder', this file will
// fail to compile — catching drift immediately.
describe('RouterChunk compile-time check', () => {
  it('accepts sourceKind folder at the type level', () => {
    const chunk: RouterChunk = {
      id: 'folder:abc:chunk:0',
      text: 'doc text',
      sourceKind: 'folder', // must compile; TS error if SourceKind doesn't include 'folder'
      sourceId: 'file:xyz',
      title: 'doc.txt',
      sensitivity: 'folder:low',
    };
    expect(chunk.sourceKind).toBe('folder');
  });
});
