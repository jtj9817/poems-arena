import { describe, expect, test } from 'bun:test';
import { createDbReadinessManager } from './readiness-manager';

describe('createDbReadinessManager', () => {
  test('marks status ready after successful warm-up ping', async () => {
    let calls = 0;
    const manager = createDbReadinessManager({
      ping: async () => {
        calls += 1;
      },
      maxAttempts: 3,
      retryDelayMs: 1,
      waitTimeoutMs: 20,
    });

    await manager.ensureReady();

    const snapshot = manager.getSnapshot();
    expect(calls).toBe(1);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.ready).toBe(true);
    expect(snapshot.attempts).toBe(1);
    expect(snapshot.lastError).toBeNull();
    expect(snapshot.readyAt).not.toBeNull();
  });

  test('retries failed warm-up pings and succeeds when later attempt passes', async () => {
    let calls = 0;
    const manager = createDbReadinessManager({
      ping: async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error(`fail-${calls}`);
        }
      },
      maxAttempts: 4,
      retryDelayMs: 1,
      waitTimeoutMs: 30,
    });

    await manager.ensureReady();

    const snapshot = manager.getSnapshot();
    expect(calls).toBe(3);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.attempts).toBe(3);
    expect(snapshot.lastError).toBeNull();
  });

  test('surfaces failed status after max retry exhaustion', async () => {
    const manager = createDbReadinessManager({
      ping: async () => {
        throw new Error('unreachable');
      },
      maxAttempts: 2,
      retryDelayMs: 1,
      waitTimeoutMs: 30,
    });

    await expect(manager.ensureReady()).rejects.toThrow('Database warm-up failed: unreachable');

    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe('failed');
    expect(snapshot.ready).toBe(false);
    expect(snapshot.attempts).toBe(2);
    expect(snapshot.lastError).toBe('unreachable');
  });

  test('times out while warm-up is still pending', async () => {
    const manager = createDbReadinessManager({
      ping: async () => {
        await new Promise(() => {
          /* intentionally pending */
        });
      },
      maxAttempts: 1,
      retryDelayMs: 1,
      waitTimeoutMs: 5,
    });

    await expect(manager.ensureReady()).rejects.toThrow('Database warm-up timed out after 5ms');

    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe('pending');
    expect(snapshot.ready).toBe(false);
    expect(snapshot.attempts).toBe(1);
  });
});
