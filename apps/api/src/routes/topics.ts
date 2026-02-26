import { Hono } from 'hono';
import { asc } from 'drizzle-orm';
import type { Db } from '@sanctuary/db';
import { topics } from '../db/schema';

export function createTopicsRouter(db: Db) {
  const router = new Hono();

  // GET /topics — returns all canonical topics ordered by label
  router.get('/', async (c) => {
    const rows = await db
      .select({ id: topics.id, label: topics.label })
      .from(topics)
      .orderBy(asc(topics.label));

    return c.json(rows);
  });

  return router;
}
