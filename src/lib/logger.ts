import pino from 'pino';

// This module is imported from both server code (API routes) and client
// components (bug-report log capture). Bundlers resolve `pino` to its
// dependency-free browser build (`pino/browser.js`, via the package's
// "browser" field) on the client, so nothing node-only is pulled in as long as
// we never configure `transport` / `destination` here. Server-side, pino is
// externalized via `serverExternalPackages` in next.config.ts.
const isServer = typeof window === 'undefined';

export const logger = pino(
  isServer
    ? {
        level: process.env.LOG_LEVEL || 'info',
        formatters: {
          level: (label) => {
            return { level: label };
          },
        },
      }
    : {
        // The browser build logs straight to console; keep it quiet by default.
        level: process.env.NEXT_PUBLIC_LOG_LEVEL || 'info',
      },
);

// Create child loggers for different modules
export const ocrLogger = logger.child({ module: 'ocr' });
export const helpCheckLogger = logger.child({ module: 'help-check' });
export const solutionLogger = logger.child({ module: 'solution-generation' });
export const voiceLogger = logger.child({ module: 'voice' });

// Client-side console log ring buffer for bug reports.
// Captures the most recent N console messages so users can attach them when
// reporting a problem.
export type ClientLogEntry = {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  time: string;
  args: string[];
};

const MAX_CLIENT_LOGS = 200;
const clientLogBuffer: ClientLogEntry[] = [];
let clientLogsInstalled = false;

function safeStringify(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  }
  try {
    return JSON.stringify(arg, (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
  } catch {
    return String(arg);
  }
}

export function installClientLogCapture() {
  if (typeof window === 'undefined' || clientLogsInstalled) return;
  clientLogsInstalled = true;

  const levels: ClientLogEntry['level'][] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        clientLogBuffer.push({
          level,
          time: new Date().toISOString(),
          args: args.map(safeStringify),
        });
        if (clientLogBuffer.length > MAX_CLIENT_LOGS) {
          clientLogBuffer.splice(0, clientLogBuffer.length - MAX_CLIENT_LOGS);
        }
      } catch {
        // Never let log capture break the app.
      }
      original(...args);
    };
  }

  window.addEventListener('error', (e) => {
    clientLogBuffer.push({
      level: 'error',
      time: new Date().toISOString(),
      args: [`window.onerror: ${e.message}`, `${e.filename}:${e.lineno}:${e.colno}`],
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    clientLogBuffer.push({
      level: 'error',
      time: new Date().toISOString(),
      args: [`unhandledrejection: ${safeStringify(e.reason)}`],
    });
  });
}

export function getClientLogs(): ClientLogEntry[] {
  return clientLogBuffer.slice();
}
