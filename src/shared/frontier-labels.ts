/**
 * Shared frontier-provider display labels.
 *
 * Single source of truth for the human-readable model name shown in renderer
 * UI (Settings → Briefing "LLM route", SchedulingChat "Routes through …",
 * etc). Keep in sync with src/main/llm/providers.ts DEFAULT_*_MODEL constants.
 *
 * The main-process providers module owns the runtime model selection; this
 * file owns only the renderer-side label so we never hardcode a model
 * string inside a JSX prop again.
 */
import type { ProviderId } from './ipc-contract';

export interface FrontierLabel {
  /** Vendor name, capitalized. */
  vendor: string;
  /** Default model id (must match main/llm/providers.ts DEFAULT_*_MODEL). */
  modelId: string;
  /** Human-friendly model name (used in long-form sentences). */
  modelDisplay: string;
}

export const FRONTIER_LABELS: Record<ProviderId, FrontierLabel> = {
  anthropic: {
    vendor: 'Anthropic',
    modelId: 'claude-sonnet-4-5',
    modelDisplay: 'Claude Sonnet 4.5',
  },
  openai: {
    vendor: 'OpenAI',
    modelId: 'gpt-4o-mini',
    modelDisplay: 'GPT-4o mini',
  },
  google: {
    vendor: 'Google',
    modelId: 'gemini-2.5-flash',
    modelDisplay: 'Gemini 2.5 Flash',
  },
};

/** Default vendor used when the renderer hasn't yet loaded the active one. */
export const DEFAULT_FRONTIER_PROVIDER: ProviderId = 'anthropic';

/** "Claude Sonnet 4.5" or fallback "frontier model" when provider is null. */
export function frontierModelDisplay(provider: ProviderId | null | undefined): string {
  if (!provider) return FRONTIER_LABELS[DEFAULT_FRONTIER_PROVIDER].modelDisplay;
  return FRONTIER_LABELS[provider].modelDisplay;
}

/** "Anthropic Claude Sonnet 4.5" / fallback. */
export function frontierFullLabel(provider: ProviderId | null | undefined): string {
  const p = provider ?? DEFAULT_FRONTIER_PROVIDER;
  const lbl = FRONTIER_LABELS[p];
  return `${lbl.vendor} ${lbl.modelDisplay}`;
}
