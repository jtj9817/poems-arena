import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import { resolveDbConfig } from './config';

const config = resolveDbConfig();
const libsql = createClient(config);

export const db = drizzle(libsql, { schema });
