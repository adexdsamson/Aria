import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Two-project Vitest config (VALIDATION Wave 0):
 *   - main: node env, covers src/main + src/shared + src/preload
 *   - renderer: jsdom env, covers src/renderer
 *
 * Shared setup file mocks electron.safeStorage and provides a
 * temp-userData factory (tests/setup.ts).
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // globalSetup runs ONCE before all tests; swaps the Node-ABI
    // better-sqlite3 binary in and restores the Electron-ABI one on teardown.
    // See tests/setup-native-abi.ts + scripts/build-native-dual.mjs.
    globalSetup: ['tests/setup-native-abi.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'src/main/**/*.{test,spec}.ts',
            'src/shared/**/*.{test,spec}.ts',
            'src/preload/**/*.{test,spec}.ts',
            'tests/unit/main/**/*.{test,spec}.ts',
            'tests/static/**/*.{test,spec}.ts',
          ],
          setupFiles: ['tests/setup.ts'],
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared'),
          },
        },
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: [
            'src/renderer/**/*.{test,spec}.{ts,tsx}',
            'tests/unit/renderer/**/*.{test,spec}.{ts,tsx}',
          ],
          setupFiles: ['tests/setup.ts'],
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared'),
            '@renderer': resolve(__dirname, 'src/renderer'),
          },
        },
      },
    ],
  },
});
