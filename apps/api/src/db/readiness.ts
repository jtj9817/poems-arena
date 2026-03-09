import { db } from './client';
import { createDbReadinessManager } from './readiness-manager';

type LibsqlClient = {
  execute: (query: string) => Promise<unknown>;
};

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const readinessManager = createDbReadinessManager({
  ping: async () => {
    const client = (db as { $client?: unknown }).$client as LibsqlClient | undefined;
    if (!client || typeof client.execute !== 'function') {
      throw new Error('LibSQL client is unavailable');
    }
    await client.execute('SELECT 1');
  },
  maxAttempts: parseEnvNumber(process.env.DB_READY_MAX_ATTEMPTS, 4),
  retryDelayMs: parseEnvNumber(process.env.DB_READY_RETRY_DELAY_MS, 300),
  waitTimeoutMs: parseEnvNumber(process.env.DB_READY_WAIT_TIMEOUT_MS, 2500),
});

export function startDbWarmup(): Promise<void> {
  return readinessManager.start();
}

export function ensureDbReady(timeoutMs?: number): Promise<void> {
  return readinessManager.ensureReady(timeoutMs);
}

export function getDbReadinessSnapshot() {
  return readinessManager.getSnapshot();
}
