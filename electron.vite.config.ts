import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin, type UserConfig } from 'electron-vite';
import { loadEnv } from 'vite';
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
 *
 * Quick 260523-f73 — OAuth credentials baked into the main bundle.
 * `loadEnv` reads `.env`, `.env.local`, `.env.<mode>` from the project root
 * at BUILD time. The values are inlined as string literals into out/main via
 * Vite's `define`, so packaged binaries (which lose the build machine's
 * shell env) still have the credentials. Desktop OAuth client secrets are
 * "not secrets in the cryptographic sense" per Google's published policy —
 * they're public-by-design for desktop apps. Empty string fallback so the
 * existing `if (!clientId || !clientSecret)` check still trips
 * `OAuthConfigMissingError` cleanly when nothing is set.
 */
// Build-time env (loadEnv reads .env, .env.local, .env.<mode> from cwd).
const buildEnv = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const oauthDefine = {
  'process.env.GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(
    buildEnv.GOOGLE_OAUTH_CLIENT_ID ?? '',
  ),
  'process.env.GOOGLE_OAUTH_CLIENT_SECRET': JSON.stringify(
    buildEnv.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  ),
  'process.env.MS_OAUTH_CLIENT_ID': JSON.stringify(
    buildEnv.MS_OAUTH_CLIENT_ID ?? '',
  ),
  'process.env.MS_OAUTH_TENANT_ID': JSON.stringify(
    buildEnv.MS_OAUTH_TENANT_ID ?? '',
  ),
} as const;

const config: UserConfig = {
  main: {
    // Baileys is ESM-only; bundling it into out/main via Rollup (instead of
    // leaving it as an external require) is the only way to make it work in
    // Electron's CommonJS main process. Every other dep stays external.
    // Mirror of the preload zod-exclude pattern at line 67.
    //
    // `include` force-externalizes Baileys' CJS dependencies so only Baileys'
    // own pure-ESM `lib/` is bundled. Two failure modes this prevents:
    //   1. Media peerDeps (jimp/sharp/link-preview-js/audio-decode): reached only
    //      via lazy `import('jimp').catch(() => {})` for thumbnails — a path Aria
    //      never runs (passive, text-only per WA-07, never sends). Bundling them
    //      makes Rollup fail on jimp's broken `exports` map.
    //   2. `ws` (CommonJS): Baileys' websocket dep. Bundling ws drags in its
    //      OPTIONAL native addons `bufferutil`/`utf-8-validate` (not installed) as
    //      hard `require()`s → runtime "Could not resolve 'bufferutil'". Left
    //      external, `require('ws')` works in the CJS main and ws's own try/catch
    //      falls back to its pure-JS frame codec.
    // Do NOT add ESM-only baileys deps (e.g. music-metadata) here — externalizing
    // them would emit `require()` of ESM and throw ERR_REQUIRE_ESM.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@whiskeysockets/baileys'],
        include: ['jimp', 'sharp', 'link-preview-js', 'audio-decode', 'ws'],
      }),
    ],
    define: oauthDefine,
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
    // Preload runs in Electron's sandboxed context — CommonJS `require()` cannot
    // resolve node_modules from the renderer's preload host. Anything pulled in
    // via @shared (e.g. zod schemas in ipc-contract.ts) MUST be bundled INTO
    // preload/index.js rather than left as an external require. Exclude zod
    // from electron-vite's default `externalize-deps` plugin so it's inlined.
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
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
