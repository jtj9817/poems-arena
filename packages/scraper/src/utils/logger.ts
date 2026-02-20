export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LoggerMeta = Record<string, unknown>;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isTrue(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

export function resolveLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  if (isTrue(env.SCRAPER_VERBOSE)) {
    return 'debug';
  }

  const configuredLevel = env.SCRAPER_LOG_LEVEL?.toLowerCase();
  if (configuredLevel === 'debug' || configuredLevel === 'info' || configuredLevel === 'warn' || configuredLevel === 'error') {
    return configuredLevel;
  }

  return 'info';
}

function shouldLog(level: LogLevel, env: Record<string, string | undefined> = process.env): boolean {
  const configuredLevel = resolveLogLevel(env);
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[configuredLevel];
}

function write(level: LogLevel, message: string, meta?: LoggerMeta): void {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  const serialized = JSON.stringify(payload);

  if (level === 'debug') {
    console.debug(serialized);
    return;
  }

  if (level === 'warn') {
    console.warn(serialized);
    return;
  }

  if (level === 'error') {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  info: (message: string, meta?: LoggerMeta) => {
    write('info', message, meta);
  },
  error: (message: string, error?: unknown, meta?: LoggerMeta) => {
    if (error === undefined) {
      write('error', message, meta);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    write('error', message, { ...meta, error: errorMessage, stack });
  },
  warn: (message: string, meta?: LoggerMeta) => {
    write('warn', message, meta);
  },
  debug: (message: string, meta?: LoggerMeta) => {
    write('debug', message, meta);
  },
};
