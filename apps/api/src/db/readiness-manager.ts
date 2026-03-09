export type DbReadinessStatus = 'pending' | 'ready' | 'failed';

export interface DbReadinessSnapshot {
  status: DbReadinessStatus;
  ready: boolean;
  attempts: number;
  startedAt: string;
  readyAt: string | null;
  lastError: string | null;
}

export interface DbReadinessManagerOptions {
  ping: () => Promise<void>;
  maxAttempts: number;
  retryDelayMs: number;
  waitTimeoutMs: number;
}

class ReadinessTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Database warm-up timed out after ${timeoutMs}ms`);
    this.name = 'ReadinessTimeoutError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new ReadinessTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

export function createDbReadinessManager(options: DbReadinessManagerOptions) {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const retryDelayMs = Math.max(0, options.retryDelayMs);
  const waitTimeoutMs = Math.max(0, options.waitTimeoutMs);

  const startedAtMs = Date.now();
  let readyAtMs: number | null = null;
  let status: DbReadinessStatus = 'pending';
  let attempts = 0;
  let lastError: Error | null = null;
  let warmupPromise: Promise<void> | null = null;

  const runWarmup = async (): Promise<void> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      try {
        await options.ping();
        status = 'ready';
        lastError = null;
        readyAtMs = Date.now();
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxAttempts) {
          await delay(retryDelayMs);
        }
      }
    }

    status = 'failed';
    throw lastError ?? new Error('Database warm-up failed');
  };

  const start = (): Promise<void> => {
    if (!warmupPromise) {
      warmupPromise = runWarmup();
    }
    return warmupPromise;
  };

  const ensureReady = async (overrideTimeoutMs?: number): Promise<void> => {
    const timeoutMs = overrideTimeoutMs ?? waitTimeoutMs;
    try {
      await withTimeout(start(), timeoutMs);
    } catch (error) {
      if (error instanceof ReadinessTimeoutError) {
        throw error;
      }

      if (status === 'failed') {
        const reason = lastError?.message ?? 'unknown error';
        throw new Error(`Database warm-up failed: ${reason}`, { cause: error });
      }

      throw error;
    }

    if (status !== 'ready') {
      throw new Error('Database is not ready');
    }
  };

  const getSnapshot = (): DbReadinessSnapshot => ({
    status,
    ready: status === 'ready',
    attempts,
    startedAt: new Date(startedAtMs).toISOString(),
    readyAt: readyAtMs === null ? null : new Date(readyAtMs).toISOString(),
    lastError: lastError?.message ?? null,
  });

  return {
    start,
    ensureReady,
    getSnapshot,
  };
}
