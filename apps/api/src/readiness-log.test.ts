import { describe, expect, test } from 'bun:test';
import { formatDbReadinessFailureLog } from './readiness-log';

describe('formatDbReadinessFailureLog', () => {
  test('redacts infrastructure details when lastError is present', () => {
    const message = formatDbReadinessFailureLog('check', {
      status: 'failed',
      lastError: 'connect ECONNREFUSED libsql.internal.cluster.local:443',
    });

    expect(message).toBe('DB readiness check failed (failed): details redacted');
  });

  test('does not expose unknown errors when no error detail exists', () => {
    const message = formatDbReadinessFailureLog('middleware', {
      status: 'pending',
      lastError: null,
    });

    expect(message).toBe('DB readiness middleware failed (pending): error unavailable');
  });
});
