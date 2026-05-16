import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Three-entry electron-vite config:
 *   main     -> src/main/index.ts        (Node target, default)
 *   preload  -> src/preload/index.ts     (Node target, contextBridge)
 *   renderer -> src/renderer/index.html  (Vite + React, modern browser)
 *
 * Entry source files are created by plan 01b. This config is plan 01a's
 * tooling lock — typecheck/test:unit must parse it cleanly today.
 *
 * electron-vite v5 narrowed Main/Preload BuildOptions (Vite's `lib` field is
 * excluded). Entry points are declared via `build.rollupOptions.input`;
 * library bundling for main/preload is handled internally.
 */
const config: UserConfig = {
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
  },
};

export default defineConfig(config);
