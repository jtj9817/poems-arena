export interface DbConnectionConfig {
  url: string;
  authToken?: string;
}

export interface DbConfigEnv {
  NODE_ENV?: string;
  LIBSQL_URL?: string;
  LIBSQL_AUTH_TOKEN?: string;
  LIBSQL_AGILIQUILL_TOKEN?: string;
  LIBSQL_TEST_URL?: string;
  LIBSQL_TEST_AUTH_TOKEN?: string;
  LIBSQL_TEST_AGILIQUILL_TOKEN?: string;
}

export function resolveDbConfig(env: DbConfigEnv = process.env): DbConnectionConfig {
  if (env.NODE_ENV === 'test') {
    if (!env.LIBSQL_TEST_URL) {
      throw new Error('LIBSQL_TEST_URL environment variable is required when NODE_ENV=test');
    }

    return {
      url: env.LIBSQL_TEST_URL,
      authToken:
        env.LIBSQL_TEST_AUTH_TOKEN ??
        env.LIBSQL_AUTH_TOKEN ??
        env.LIBSQL_TEST_AGILIQUILL_TOKEN ??
        env.LIBSQL_AGILIQUILL_TOKEN,
    };
  }

  if (!env.LIBSQL_URL) {
    throw new Error('LIBSQL_URL environment variable is required');
  }

  return {
    url: env.LIBSQL_URL,
    authToken: env.LIBSQL_AUTH_TOKEN ?? env.LIBSQL_AGILIQUILL_TOKEN,
  };
}
