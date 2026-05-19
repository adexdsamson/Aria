/**
 * Renderer-only Vitest setup (Phase 7 UAT Gap 2).
 *
 * Loaded by the `renderer` project AFTER tests/setup.ts. Keeps jsdom-specific
 * imports out of the `main` (node-env) project so we don't pull DOM matchers
 * or polyfills into main-process tests.
 *
 *   Gap 2 — register @testing-library/jest-dom matchers with vitest expect.
 */
import '@testing-library/jest-dom/vitest';
