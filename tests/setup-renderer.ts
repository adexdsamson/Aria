/**
 * Renderer-only Vitest setup (Phase 7 UAT Gaps 2-3).
 *
 * Loaded by the `renderer` project AFTER tests/setup.ts. Keeps jsdom-specific
 * imports out of the `main` (node-env) project so we don't pull DOM matchers
 * or polyfills into main-process tests.
 *
 *   Gap 2 — register @testing-library/jest-dom matchers with vitest expect.
 *   Gap 3 — polyfill ResizeObserver (jsdom omits it; cmdk throws at mount).
 */
import '@testing-library/jest-dom/vitest';

if (typeof globalThis.ResizeObserver === 'undefined') {
  // Minimal no-op polyfill — sufficient for cmdk and shadcn primitives that
  // only construct an observer to track popover sizing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
