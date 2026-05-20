#!/usr/bin/env node
/**
 * Plan 08-03 Task 2 — static grep ratchet enforcing LEARN-02 invariant.
 *
 * Asserts that NO file under `src/main/learning/` (or its sources/) imports any
 * module that performs network I/O. Exits 0 on clean tree; exit 1 with a
 * diagnostic when a forbidden import is detected.
 *
 * Banned import specifiers (literal substring match in import lines):
 *   - node:http / node:https / node:net / node:dgram
 *   - 'http' / 'https' / 'net' / 'dgram' (bare specifiers)
 *   - node-fetch / axios / got / undici / ws
 *   - @sentry/* (learning/* may NEVER import Sentry directly — Sentry
 *     instrumentation belongs at higher layers and is gated by beforeSend)
 *
 * Self-test: appending `import fetch from 'node-fetch'` to any learning file
 * causes this script to exit non-zero with a clear diagnostic.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'src/main/learning');

const BANNED = [
  // Node core
  /from\s+['"]node:http['"]/,
  /from\s+['"]node:https['"]/,
  /from\s+['"]node:net['"]/,
  /from\s+['"]node:dgram['"]/,
  /from\s+['"]http['"]/,
  /from\s+['"]https['"]/,
  /from\s+['"]net['"]/,
  /from\s+['"]dgram['"]/,
  // Userland HTTP / WS
  /from\s+['"]node-fetch['"]/,
  /from\s+['"]axios['"]/,
  /from\s+['"]got['"]/,
  /from\s+['"]undici['"]/,
  /from\s+['"]ws['"]/,
  // Sentry — never directly from learning/*
  /from\s+['"]@sentry\//,
];

const FETCH_CALL = /\b(?:globalThis\.|window\.)?fetch\s*\(/;

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.mjs') || p.endsWith('.js')) {
      // Skip vitest specs — they may stub fetch for negative assertions.
      if (p.endsWith('.test.ts') || p.endsWith('.test.tsx') || p.endsWith('.spec.ts')) continue;
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);
let failures = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  // Strip line comments for cheap signal-to-noise.
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip whole-line comments
    if (/^\s*\/\//.test(line)) continue;
    for (const re of BANNED) {
      if (re.test(line)) {
        process.stderr.write(
          `[grep:no-network-from-signals] ${relative(process.cwd(), file)}:${i + 1}  forbidden import → ${line.trim()}\n`,
        );
        failures++;
      }
    }
    if (FETCH_CALL.test(line)) {
      process.stderr.write(
        `[grep:no-network-from-signals] ${relative(process.cwd(), file)}:${i + 1}  fetch() call not allowed under learning/ → ${line.trim()}\n`,
      );
      failures++;
    }
  }
}

if (failures > 0) {
  process.stderr.write(
    `\n[grep:no-network-from-signals] ${failures} violation(s) — learning/* must never import network modules or call fetch().\n`,
  );
  process.exit(1);
}

process.exit(0);
