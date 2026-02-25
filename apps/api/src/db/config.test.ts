// Verifies that the re-export chain from apps/api → @sanctuary/db is intact.
// The full resolveDbConfig test suite lives in packages/db/src/config.test.ts.
import { describe, expect, test } from 'bun:test';
import { resolveDbConfig } from './config';

describe('resolveDbConfig (via @sanctuary/db re-export)', () => {
  test('resolves production config from LIBSQL_URL', () => {
    const config = resolveDbConfig({
      LIBSQL_URL: 'libsql://prod.example.com',
      LIBSQL_AUTH_TOKEN: 'token',
    });

    expect(config.url).toBe('libsql://prod.example.com');
    expect(config.authToken).toBe('token');
  });

  test('throws when LIBSQL_URL is absent', () => {
    expect(() => resolveDbConfig({})).toThrow('LIBSQL_URL environment variable is required');
  });
});
