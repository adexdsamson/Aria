/**
 * frontier-labels — assert renderer label helpers stay in sync with the
 * main-process DEFAULT_*_MODEL constants in src/main/llm/providers.ts.
 *
 * Importing the main-process module from a node-env test catches drift
 * automatically: if someone bumps DEFAULT_ANTHROPIC_MODEL to a new SKU,
 * this test fails until FRONTIER_LABELS is updated to match.
 */
import { describe, expect, it } from 'vitest';
import {
  FRONTIER_LABELS,
  DEFAULT_FRONTIER_PROVIDER,
  frontierFullLabel,
  frontierModelDisplay,
} from './frontier-labels';
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_GOOGLE_MODEL,
} from '../main/llm/providers';

describe('frontier-labels', () => {
  it('modelId mirrors the main-process default model constants', () => {
    expect(FRONTIER_LABELS.anthropic.modelId).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(FRONTIER_LABELS.openai.modelId).toBe(DEFAULT_OPENAI_MODEL);
    expect(FRONTIER_LABELS.google.modelId).toBe(DEFAULT_GOOGLE_MODEL);
  });

  it('frontierModelDisplay falls back to the default provider when null', () => {
    expect(frontierModelDisplay(null)).toBe(
      FRONTIER_LABELS[DEFAULT_FRONTIER_PROVIDER].modelDisplay,
    );
  });

  it('frontierFullLabel concatenates vendor + modelDisplay', () => {
    expect(frontierFullLabel('anthropic')).toBe('Anthropic Claude Sonnet 4.5');
    expect(frontierFullLabel('openai')).toBe('OpenAI GPT-4o mini');
    expect(frontierFullLabel('google')).toBe('Google Gemini 2.5 Flash');
  });

  it('frontierFullLabel falls back on null/undefined provider', () => {
    expect(frontierFullLabel(null)).toBe('Anthropic Claude Sonnet 4.5');
    expect(frontierFullLabel(undefined)).toBe('Anthropic Claude Sonnet 4.5');
  });
});
