// mcp-agent-manager/src/services/logger.ts
// Minimal structured logger

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0, warn: 1, info: 2, debug: 3, trace: 4,
};

const currentLevel: LogLevel = (process.env.MCP_LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

function fmt(level: LogLevel, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  if (data && Object.keys(data).length > 0) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

export const logger = {
  error(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('error')) process.stderr.write(fmt('error', msg, data) + '\n');
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) process.stderr.write(fmt('warn', msg, data) + '\n');
  },
  info(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) process.stderr.write(fmt('info', msg, data) + '\n');
  },
  debug(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) process.stderr.write(fmt('debug', msg, data) + '\n');
  },
  trace(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog('trace')) process.stderr.write(fmt('trace', msg, data) + '\n');
  },
};
