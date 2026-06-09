/**
 * Gate 11: electron-vite main section externalize-exclude ratchet.
 *
 * Asserts that electron.vite.config.ts main section has a `plugins` array
 * containing an externalizeDepsPlugin whose exclude list includes
 * '@whiskeysockets/baileys' — the Baileys ESM→CJS bundling fix (Correction #2).
 *
 * We read the file as text and parse the config structurally rather than
 * importing it, because importing it would require electron-vite to be fully
 * installed in the test environment and would trigger loadEnv side effects.
 *
 * Assertion strategy:
 *   - File text contains `plugins` inside the `main:` section.
 *   - File text contains `externalizeDepsPlugin` with `@whiskeysockets/baileys`
 *     in the exclude array prior to the `preload:` section.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../');
const CONFIG_PATH = path.join(ROOT, 'electron.vite.config.ts');

describe('electron-vite config gate (Gate 11)', () => {
  let configText: string;

  it('electron.vite.config.ts is readable', () => {
    configText = fs.readFileSync(CONFIG_PATH, 'utf8');
    expect(configText.length).toBeGreaterThan(0);
  });

  it('main: section exists and contains a plugins key', () => {
    if (!configText) configText = fs.readFileSync(CONFIG_PATH, 'utf8');
    // Extract the main: block — from "main: {" up to "preload: {"
    const mainStart = configText.indexOf('main: {');
    const preloadStart = configText.indexOf('preload: {');
    expect(mainStart, 'main: section must exist').toBeGreaterThan(-1);
    expect(preloadStart, 'preload: section must exist').toBeGreaterThan(-1);
    const mainSection = configText.slice(mainStart, preloadStart);
    expect(mainSection, 'main: section must contain a plugins key').toContain('plugins');
  });

  it('main: plugins contains externalizeDepsPlugin with @whiskeysockets/baileys in exclude', () => {
    if (!configText) configText = fs.readFileSync(CONFIG_PATH, 'utf8');
    const mainStart = configText.indexOf('main: {');
    const preloadStart = configText.indexOf('preload: {');
    const mainSection = configText.slice(mainStart, preloadStart);

    // externalizeDepsPlugin must appear in the main section
    expect(mainSection).toContain('externalizeDepsPlugin');

    // The exclude array must contain '@whiskeysockets/baileys'
    expect(mainSection).toContain('@whiskeysockets/baileys');
  });

  it('preload: plugins still retains the zod exclude (regression guard)', () => {
    if (!configText) configText = fs.readFileSync(CONFIG_PATH, 'utf8');
    const preloadStart = configText.indexOf('preload: {');
    const rendererStart = configText.indexOf('renderer: {');
    const preloadSection = configText.slice(preloadStart, rendererStart);
    expect(preloadSection).toContain("exclude: ['zod']");
  });
});
