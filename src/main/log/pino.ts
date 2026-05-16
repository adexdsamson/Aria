/**
 * Pino logger singleton with PII redaction at the formatters.log hook.
 *
 * - Transport: pino-roll, daily-rotated file `<userData>/logs/aria.log`,
 *   keeping up to 30 files (RESEARCH §Logging).
 * - Redaction: every log record is passed through `redactObject` BEFORE
 *   serialization, so PII never reaches disk.
 *
 * Built lazily so unit tests that mock `electron` can stub `app.getPath`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import pino, { type Logger } from 'pino';
import { redactObject } from './redact';

let _logger: Logger | null = null;

function resolveUserDataDir(): string {
  // Imported lazily so test runs that mock `electron` (tests/setup.ts) work.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return app.getPath('userData');
}

export function getLogsDir(): string {
  const dir = path.join(resolveUserDataDir(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function createLogger(): Logger {
  const logsDir = getLogsDir();
  const logFile = path.join(logsDir, 'aria.log');

  const transport = pino.transport({
    target: 'pino-roll',
    options: {
      file: logFile,
      frequency: 'daily',
      mkdir: true,
      limit: { count: 30 },
    },
  });

  return pino(
    {
      level: process.env.ARIA_LOG_LEVEL ?? 'info',
      base: { app: 'aria' },
      formatters: {
        // Redact PII from every log record before serialization (T-01-01b-03).
        log(object: Record<string, unknown>) {
          return redactObject(object) as Record<string, unknown>;
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport,
  );
}

export function getLogger(): Logger {
  if (!_logger) _logger = createLogger();
  return _logger;
}

/** Test-only: reset the singleton between tests. */
export function _resetLoggerForTests(): void {
  _logger = null;
}
