/**
 * Route-level unit tests for the topics router.
 *
 * Uses an in-memory LibSQL database so tests run against real Drizzle queries
 * without hitting the remote Turso instance.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import { createTopicsRouter } from './topics';

// ── in-memory DB setup ───────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function createTestDb(): Promise<TestDb> {
  const client = createClient({ url: 'file::memory:' });
  await client.execute(`CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  return drizzle(client, { schema });
}

function createTestApp(db: TestDb) {
  const app = new Hono();
  app.route('/', createTopicsRouter(db));
  return app;
}

// ── GET /topics ───────────────────────────────────────────────────────────────

describe('GET /topics', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns empty array when no topics exist', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test('returns all topics with id and label', async () => {
    await db.insert(schema.topics).values([
      { id: 'topic-nature', label: 'Nature' },
      { id: 'topic-love', label: 'Love' },
    ]);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; label: string }>;
    expect(body).toHaveLength(2);

    const ids = body.map((t) => t.id);
    expect(ids).toContain('topic-nature');
    expect(ids).toContain('topic-love');
  });

  test('returns topics ordered by label ascending', async () => {
    await db.insert(schema.topics).values([
      { id: 'topic-z', label: 'Zen' },
      { id: 'topic-a', label: 'Autumn' },
      { id: 'topic-m', label: 'Memory' },
    ]);

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; label: string }>;
    expect(body.map((t) => t.label)).toEqual(['Autumn', 'Memory', 'Zen']);
  });

  test('response items have exactly id and label fields', async () => {
    await db.insert(schema.topics).values({ id: 'topic-solo', label: 'Solo' });

    const res = await app.request('/');
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Object.keys(body[0]).sort()).toEqual(['id', 'label']);
  });
});
