/**
 * Route-level unit tests for the votes router.
 *
 * Uses an in-memory LibSQL database so tests run against real Drizzle queries
 * without hitting the remote Turso instance.
 *
 * Coverage:
 * - POST /votes: request validation (readingTimeMs, duelId, selectedPoemId)
 * - Outlier clamping: readingTimeMs > 10 minutes clamped to 10 minutes
 * - Rejection: readingTimeMs <= 0 returns 400 and does not insert vote
 * - Atomic aggregate updates: global_statistics and topic_statistics incremented correctly
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import { createVotesRouter } from './votes';

// ── in-memory DB setup ───────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function createTestDb(): Promise<TestDb> {
  // Use file::memory: for fast in-memory tests. Note: db.$client.close() is
  // intentionally NOT called in afterEach because closing a file::memory:
  // connection in @libsql/client corrupts the module-level SQLite state for
  // subsequent connections (causes "no such table" inside db.transaction()).
  // In-memory DBs are private to each connection and are GC'd automatically.
  const client = createClient({ url: 'file::memory:' });

  const ddl = [
    `CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS poems (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      year TEXT,
      source TEXT,
      source_url TEXT,
      form TEXT,
      prompt TEXT,
      parent_poem_id TEXT REFERENCES poems(id)
    )`,
    `CREATE TABLE IF NOT EXISTS duels (
      id TEXT PRIMARY KEY NOT NULL,
      topic TEXT NOT NULL,
      topic_id TEXT NOT NULL REFERENCES topics(id),
      poem_a_id TEXT NOT NULL REFERENCES poems(id),
      poem_b_id TEXT NOT NULL REFERENCES poems(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      duel_id TEXT NOT NULL REFERENCES duels(id),
      selected_poem_id TEXT NOT NULL REFERENCES poems(id),
      is_human INTEGER NOT NULL,
      reading_time_ms INTEGER NOT NULL,
      voted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS global_statistics (
      id TEXT PRIMARY KEY NOT NULL DEFAULT 'global',
      total_votes INTEGER NOT NULL DEFAULT 0,
      human_votes INTEGER NOT NULL DEFAULT 0,
      decision_time_sum_ms INTEGER NOT NULL DEFAULT 0,
      decision_time_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS topic_statistics (
      topic_id TEXT PRIMARY KEY NOT NULL REFERENCES topics(id),
      topic_label TEXT NOT NULL,
      total_votes INTEGER NOT NULL DEFAULT 0,
      human_votes INTEGER NOT NULL DEFAULT 0,
      decision_time_sum_ms INTEGER NOT NULL DEFAULT 0,
      decision_time_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  ];

  for (const stmt of ddl) {
    await client.execute(stmt);
  }

  return drizzle(client, { schema });
}

function createTestApp(db: TestDb) {
  const app = new Hono();
  app.route('/', createVotesRouter(db));
  return app;
}

// ── shared seed data ─────────────────────────────────────────────────────────

const TOPIC_NATURE = { id: 'topic-nature', label: 'Nature' };
const POEM_HUMAN = {
  id: 'poem-human-1',
  title: 'The Road Not Taken',
  content: 'Two roads diverged in a yellow wood',
  author: 'Robert Frost',
  type: 'HUMAN' as const,
};
const POEM_AI = {
  id: 'poem-ai-1',
  title: 'Generated Verse',
  content: 'A machine contemplates the autumn leaves',
  author: 'deepseek-chat',
  type: 'AI' as const,
};
const DUEL_1 = {
  id: 'duel-001',
  topic: 'Nature',
  topicId: 'topic-nature',
  poemAId: 'poem-human-1',
  poemBId: 'poem-ai-1',
};

async function seedBase(db: TestDb) {
  await db.insert(schema.topics).values(TOPIC_NATURE);
  await db.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
  await db.insert(schema.duels).values(DUEL_1);
}

// ── POST /votes ───────────────────────────────────────────────────────────────

describe('POST /votes — request validation', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await seedBase(db);
  });

  afterEach(() => {
    // Intentionally not closing db.$client — see createTestDb() comment.
  });

  test('returns 200 with isHuman=true when selecting human poem', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; isHuman: boolean };
    expect(body.success).toBe(true);
    expect(body.isHuman).toBe(true);
  });

  test('returns 200 with isHuman=false when selecting AI poem', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-ai-1',
        readingTimeMs: 45000,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; isHuman: boolean };
    expect(body.success).toBe(true);
    expect(body.isHuman).toBe(false);
  });

  test('returns 400 when readingTimeMs is missing', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duelId: 'duel-001', selectedPoemId: 'poem-human-1' }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 400 and does not insert vote when readingTimeMs is 0', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 0,
      }),
    });
    expect(res.status).toBe(400);
    const voteRows = await db.select().from(schema.votes);
    expect(voteRows).toHaveLength(0);
  });

  test('returns 400 and does not insert vote when readingTimeMs is negative', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: -1,
      }),
    });
    expect(res.status).toBe(400);
    const voteRows = await db.select().from(schema.votes);
    expect(voteRows).toHaveLength(0);
  });

  test('returns 400 when readingTimeMs is not an integer', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 1.5,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 when duel does not exist', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'nonexistent',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });
    expect(res.status).toBe(404);
  });

  test('returns 400 when selectedPoemId does not belong to the duel', async () => {
    await db.insert(schema.poems).values({
      id: 'poem-other',
      title: 'Other',
      content: 'x',
      author: 'Other',
      type: 'HUMAN',
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-other',
        readingTimeMs: 30000,
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /votes — outlier clamping ────────────────────────────────────────────

describe('POST /votes — readingTimeMs clamping', () => {
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await seedBase(db);
  });

  afterEach(() => {
    // Intentionally not closing db.$client — see createTestDb() comment.
  });

  test('accepts readingTimeMs exactly at 10 minutes without clamping', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: TEN_MINUTES_MS,
      }),
    });
    expect(res.status).toBe(200);
    const voteRows = await db.select().from(schema.votes);
    expect(voteRows[0].readingTimeMs).toBe(TEN_MINUTES_MS);
  });

  test('clamps readingTimeMs over 10 minutes to 10 minutes in the vote row', async () => {
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: TEN_MINUTES_MS + 1,
      }),
    });
    expect(res.status).toBe(200);
    const voteRows = await db.select().from(schema.votes);
    expect(voteRows[0].readingTimeMs).toBe(TEN_MINUTES_MS);
  });

  test('clamped readingTimeMs contributes clamped value to decisionTimeSumMs in global_statistics', async () => {
    const oversized = TEN_MINUTES_MS + 99999;
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: oversized,
      }),
    });
    const globalRows = await db.select().from(schema.globalStatistics);
    expect(globalRows[0].decisionTimeSumMs).toBe(TEN_MINUTES_MS);
    expect(globalRows[0].decisionTimeCount).toBe(1);
  });
});

// ── POST /votes — aggregate updates ──────────────────────────────────────────

describe('POST /votes — aggregate updates', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await seedBase(db);
  });

  afterEach(() => {
    // Intentionally not closing db.$client — see createTestDb() comment.
  });

  test('first vote creates global_statistics row with correct counts', async () => {
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });

    const globalRows = await db.select().from(schema.globalStatistics);
    expect(globalRows).toHaveLength(1);
    expect(globalRows[0].id).toBe('global');
    expect(globalRows[0].totalVotes).toBe(1);
    expect(globalRows[0].humanVotes).toBe(1);
    expect(globalRows[0].decisionTimeSumMs).toBe(30000);
    expect(globalRows[0].decisionTimeCount).toBe(1);
  });

  test('second vote increments global_statistics correctly', async () => {
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-ai-1',
        readingTimeMs: 20000,
      }),
    });

    const [globalRow] = await db.select().from(schema.globalStatistics);
    expect(globalRow.totalVotes).toBe(2);
    expect(globalRow.humanVotes).toBe(1);
    expect(globalRow.decisionTimeSumMs).toBe(50000);
    expect(globalRow.decisionTimeCount).toBe(2);
  });

  test('first vote creates topic_statistics row for the duel topic', async () => {
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });

    const topicRows = await db.select().from(schema.topicStatistics);
    expect(topicRows).toHaveLength(1);
    expect(topicRows[0].topicId).toBe('topic-nature');
    expect(topicRows[0].topicLabel).toBe('Nature');
    expect(topicRows[0].totalVotes).toBe(1);
    expect(topicRows[0].humanVotes).toBe(1);
    expect(topicRows[0].decisionTimeSumMs).toBe(30000);
    expect(topicRows[0].decisionTimeCount).toBe(1);
  });

  test('votes for different topics update separate topic_statistics rows', async () => {
    // Add a second topic and duel
    await db.insert(schema.topics).values({ id: 'topic-love', label: 'Love' });
    await db.insert(schema.poems).values([
      { id: 'poem-human-2', title: 'H2', content: 'x', author: 'A', type: 'HUMAN' },
      { id: 'poem-ai-2', title: 'A2', content: 'y', author: 'B', type: 'AI' },
    ]);
    await db.insert(schema.duels).values({
      id: 'duel-002',
      topic: 'Love',
      topicId: 'topic-love',
      poemAId: 'poem-human-2',
      poemBId: 'poem-ai-2',
    });

    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      }),
    });
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-002',
        selectedPoemId: 'poem-ai-2',
        readingTimeMs: 45000,
      }),
    });

    const topicRows = await db.select().from(schema.topicStatistics);
    expect(topicRows).toHaveLength(2);

    const nature = topicRows.find((r) => r.topicId === 'topic-nature')!;
    expect(nature.totalVotes).toBe(1);
    expect(nature.humanVotes).toBe(1);
    expect(nature.decisionTimeSumMs).toBe(30000);

    const love = topicRows.find((r) => r.topicId === 'topic-love')!;
    expect(love.totalVotes).toBe(1);
    expect(love.humanVotes).toBe(0);
    expect(love.decisionTimeSumMs).toBe(45000);
  });

  test('invalid vote (readingTimeMs <= 0) does not update aggregates', async () => {
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 0,
      }),
    });

    const globalRows = await db.select().from(schema.globalStatistics);
    expect(globalRows).toHaveLength(0);
    const topicRows = await db.select().from(schema.topicStatistics);
    expect(topicRows).toHaveLength(0);
  });

  test('AI vote increments totalVotes but not humanVotes in global_statistics', async () => {
    await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        duelId: 'duel-001',
        selectedPoemId: 'poem-ai-1',
        readingTimeMs: 15000,
      }),
    });

    const [globalRow] = await db.select().from(schema.globalStatistics);
    expect(globalRow.totalVotes).toBe(1);
    expect(globalRow.humanVotes).toBe(0);
  });
});
