import { createDb, resolveDbConfig } from '@sanctuary/db';

const config = resolveDbConfig();
export const db = createDb(config);
