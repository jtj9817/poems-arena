import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import type { DbConnectionConfig } from './config';
import * as schema from './schema';

/** Create an independent Drizzle + LibSQL client for the given connection config. */
export function createDb(config: DbConnectionConfig) {
  const libsql = createClient(config);
  return drizzle(libsql, { schema });
}

export type Db = ReturnType<typeof createDb>;
