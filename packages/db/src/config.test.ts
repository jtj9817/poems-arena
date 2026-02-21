import { describe, expect, test } from 'bun:test';
import { resolveDbConfig } from './config';

describe('resolveDbConfig', () => {
  test('uses dedicated test database url when NODE_ENV is test', () => {
    const config = resolveDbConfig({
      NODE_ENV: 'test',
      LIBSQL_URL: 'libsql://dev-db.example.com',
      LIBSQL_TEST_URL: 'libsql://test-db.example.com',
      LIBSQL_AGILIQUILL_TOKEN: 'dev-token',
      LIBSQL_TEST_AGILIQUILL_TOKEN: 'test-token',
    });

    expect(config.url).toBe('libsql://test-db.example.com');
    expect(config.authToken).toBe('test-token');
  });

  test('throws in test mode when LIBSQL_TEST_URL is missing', () => {
    expect(() =>
      resolveDbConfig({
        NODE_ENV: 'test',
        LIBSQL_URL: 'libsql://dev-db.example.com',
      }),
    ).toThrow('LIBSQL_TEST_URL environment variable is required when NODE_ENV=test');
  });

  test('uses development database url outside test mode', () => {
    const config = resolveDbConfig({
      NODE_ENV: 'development',
      LIBSQL_URL: 'libsql://dev-db.example.com',
      LIBSQL_AGILIQUILL_TOKEN: 'dev-token',
    });

    expect(config.url).toBe('libsql://dev-db.example.com');
    expect(config.authToken).toBe('dev-token');
  });

  test('throws outside test mode when LIBSQL_URL is missing', () => {
    expect(() =>
      resolveDbConfig({
        NODE_ENV: 'development',
      }),
    ).toThrow('LIBSQL_URL environment variable is required');
  });

  test('falls back to LIBSQL_AGILIQUILL_TOKEN for test auth when dedicated token absent', () => {
    const config = resolveDbConfig({
      NODE_ENV: 'test',
      LIBSQL_TEST_URL: 'libsql://test-db.example.com',
      LIBSQL_AGILIQUILL_TOKEN: 'shared-token',
    });

    expect(config.authToken).toBe('shared-token');
  });
});
