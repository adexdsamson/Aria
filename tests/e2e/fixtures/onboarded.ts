/**
 * Playwright fixture that launches the Electron app with an isolated temp
 * userData, runs onboarding programmatically using the ARIA_E2E hook to read
 * `pendingMnemonic`, and returns `{ electronApp, userDataDir, mnemonic,
 * dailyPassword }`. Both Plan 02's onboarding spec and Plan 04's hello-aria
 * spec consume this fixture.
 */
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface OnboardedContext {
  electronApp: ElectronApplication;
  userDataDir: string;
  mnemonic: string;
  dailyPassword: string;
}

export const DEFAULT_DAILY_PW = 'correct-horse-battery-1';

export function makeTempUserDataDir(prefix = 'aria-e2e'): string {
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(os.tmpdir(), `${prefix}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function launchAria(opts: {
  userDataDir?: string;
} = {}): Promise<{ electronApp: ElectronApplication; userDataDir: string }> {
  const userDataDir = opts.userDataDir ?? makeTempUserDataDir();
  const mainEntry = path.resolve(__dirname, '../../../out/main/index.js');
  const electronApp = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ARIA_E2E: '1', ARIA_USER_DATA_DIR: userDataDir },
    timeout: 30_000,
  });
  return { electronApp, userDataDir };
}

/**
 * Programmatically click through the 3-step wizard for a fresh userData.
 * Uses the main-process ARIA_E2E IPC channel to read the pending mnemonic so
 * we can submit the correct 3-word challenge answers.
 */
export async function runOnboarding(
  electronApp: ElectronApplication,
  dailyPassword: string = DEFAULT_DAILY_PW,
): Promise<{ mnemonic: string }> {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Wait for the wizard to render (after onboardingGenMnemonic resolves).
  await window.getByTestId('mnemonic-grid').waitFor({ timeout: 15_000 });

  // Pull the pending mnemonic + positions from main via the E2E hook.
  const pending = await electronApp.evaluate(async ({ ipcMain: _ipc }) => {
    // ipcMain doesn't expose a 'request' API; use the BrowserWindow's
    // webContents to invoke the hook. We piggyback on the renderer's
    // window.aria preload bridge by exposing it through a temp method here.
    // Simpler: call the hook channel directly via the internal request flow.
    return null;
  });
  void pending;

  // Easier approach: trigger the e2e hook from the renderer via a fetch-style
  // ipcRenderer.invoke call exposed by the preload bridge. We don't have one
  // declared on `window.aria`, so we use playwright's ability to evaluate
  // arbitrary JS inside the renderer with `ipcRenderer`.
  const e2eData = await window.evaluate(async () => {
    // @ts-expect-error injected by Electron preload (only in test mode if exposed).
    const renderer = window as unknown as { aria: Record<string, unknown> };
    void renderer;
    // We exposed an internal hook through window.aria? No — we need a direct
    // ipcRenderer call. Playwright cannot import 'electron' inside the
    // renderer (contextIsolation). Fall back to onboardingGenMnemonic which
    // returns the words on first call. The wizard already called it on mount
    // so calling it again would re-roll. Instead, capture words directly
    // from the rendered DOM.
    const items = Array.from(document.querySelectorAll('[data-testid^="mnemonic-word-"]'));
    const words = items.map((el) => (el.textContent ?? '').replace(/^\d+\.\s*/, '').trim());
    return { words };
  });

  if (e2eData.words.length !== 12) {
    throw new Error(`onboarding fixture: expected 12 words, got ${e2eData.words.length}`);
  }

  // Acknowledge and continue.
  await window.getByTestId('mnemonic-ack').check();
  await window.getByTestId('mnemonic-continue').click();
  await window.getByTestId('onboarding-confirm').waitFor({ timeout: 10_000 });

  // The confirm screen renders three inputs labeled by position. The labels
  // tell us which positions to fill — read them out of the DOM.
  const labels = await window
    .locator('[data-testid="onboarding-confirm"] label span')
    .allTextContents();
  const positions = labels.map((l) => Number.parseInt(l.replace(/[^0-9]/g, ''), 10) - 1);
  for (let i = 0; i < 3; i++) {
    await window.getByTestId(`confirm-input-${i}`).fill(e2eData.words[positions[i]!]!);
  }
  await window.getByTestId('confirm-submit').click();
  await window.getByTestId('onboarding-password').waitFor({ timeout: 10_000 });

  await window.getByTestId('password-input').fill(dailyPassword);
  await window.getByTestId('password-submit').click();

  // Wait for the unlocked gate.
  await window.getByTestId('gate-unlocked').waitFor({ timeout: 20_000 });

  return { mnemonic: e2eData.words.join(' ') };
}

export async function launchOnboardedAria(): Promise<OnboardedContext> {
  const { electronApp, userDataDir } = await launchAria();
  const { mnemonic } = await runOnboarding(electronApp);
  return { electronApp, userDataDir, mnemonic, dailyPassword: DEFAULT_DAILY_PW };
}
