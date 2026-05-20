/**
 * Renderer-only Vitest setup (Phase 7 UAT Gaps 2-4).
 *
 * Loaded by the `renderer` project AFTER tests/setup.ts. Keeps jsdom-specific
 * imports out of the `main` (node-env) project so we don't pull DOM matchers
 * or polyfills into main-process tests.
 *
 *   Gap 2 — register @testing-library/jest-dom matchers with vitest expect.
 *   Gap 3 — polyfill ResizeObserver (jsdom omits it; cmdk throws at mount).
 *   Gap 4 — auto-cleanup mounted React trees between cases so bleed-through
 *           on duplicate test-ids (e.g. citation-1) doesn't cause false reds.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 25 ships a built-in `localStorage` global that requires
// `--localstorage-file=<path>` to function. Vitest's jsdom env inherits this
// broken global (constructor missing, `.clear`/`.getItem`/`.setItem` undefined)
// which crashes any renderer test that touches localStorage (Phase 5
// RecurrenceUnsupportedPill, CalendarGrid, UnifiedCalendarScreen). Install an
// in-memory polyfill that mirrors the Storage API surface our renderer uses.
{
  const store = new Map<string, string>();
  const polyfill = {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
  };
  // Replace on globalThis AND window so both lookups hit the same store.
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: true,
    configurable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: polyfill,
      writable: true,
      configurable: true,
    });
  }
}

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

afterEach(() => {
  cleanup();
});
