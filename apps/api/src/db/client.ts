import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

const url = process.env.LIBSQL_URL;
const authToken = process.env.LIBSQL_AGILIQUILL_TOKEN;

if (!url) {
  throw new Error('LIBSQL_URL environment variable is required');
}

const libsql = createClient({ url, authToken });

export const db = drizzle(libsql, { schema });
