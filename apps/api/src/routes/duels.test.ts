/**
 * Route-level unit tests for the duels router.
 *
 * Uses an in-memory LibSQL database (per describe block) so tests run against
 * real Drizzle queries without hitting the remote Turso instance.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import { createDuelsRouter } from './duels';

// ── in-memory DB setup ───────────────────────────────────────────────────────

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

async function createTestDb(options?: { includeFeaturedDuelsTable?: boolean }): Promise<TestDb> {
  const { includeFeaturedDuelsTable = true } = options ?? {};
  const client = createClient({ url: 'file::memory:' });

  // Create all required tables (optionally including featured_duels)
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
    `CREATE TABLE IF NOT EXISTS scrape_sources (
      id TEXT PRIMARY KEY NOT NULL,
      poem_id TEXT NOT NULL REFERENCES poems(id),
      source TEXT NOT NULL,
      source_url TEXT NOT NULL,
      scraped_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      raw_html TEXT,
      is_public_domain INTEGER NOT NULL DEFAULT false
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

  if (includeFeaturedDuelsTable) {
    ddl.push(`CREATE TABLE IF NOT EXISTS featured_duels (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      duel_id TEXT NOT NULL REFERENCES duels(id),
      featured_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
  }

  for (const stmt of ddl) {
    await client.execute(stmt);
  }

  return drizzle(client, { schema });
}

function createTestApp(db: TestDb) {
  const app = new Hono();
  app.route('/', createDuelsRouter(db));
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
  year: '1916',
  source: 'Poetry Foundation',
  sourceUrl: 'https://poetryfoundation.org/poem/road',
};
const POEM_AI = {
  id: 'poem-ai-1',
  title: 'Generated Verse',
  content: 'A machine contemplates the autumn leaves',
  author: 'Claude 3 Opus',
  type: 'AI' as const,
};
const DUEL_1 = {
  id: 'duel-001',
  topic: 'Nature',
  topicId: 'topic-nature',
  poemAId: 'poem-human-1',
  poemBId: 'poem-ai-1',
};

type ArchiveDuelRow = {
  id: string;
  topic: string;
  topicMeta: { id: string | null; label: string };
  createdAt: string;
  humanWinRate: number;
  avgReadingTime: string;
};

function makeWordContent(count: number, prefix = 'word'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

async function insertArchiveDuelFixture(
  db: TestDb,
  fixture: {
    duelId: string;
    poemAId: string;
    poemBId: string;
    contentA: string;
    contentB: string;
    topic?: string;
    topicId?: string | null;
  },
): Promise<void> {
  const topic = fixture.topic ?? 'Nature';
  const topicId = fixture.topicId ?? 'topic-nature';

  await db.insert(schema.poems).values([
    {
      id: fixture.poemAId,
      title: `${fixture.poemAId} title`,
      content: fixture.contentA,
      author: `${fixture.poemAId} author`,
      type: 'HUMAN',
    },
    {
      id: fixture.poemBId,
      title: `${fixture.poemBId} title`,
      content: fixture.contentB,
      author: `${fixture.poemBId} author`,
      type: 'AI',
    },
  ]);

  await db.insert(schema.duels).values({
    id: fixture.duelId,
    topic,
    topicId,
    poemAId: fixture.poemAId,
    poemBId: fixture.poemBId,
  });
}

function getArchiveDuel(rows: ArchiveDuelRow[], duelId: string): ArchiveDuelRow {
  const duel = rows.find((row) => row.id === duelId);
  expect(duel).toBeDefined();
  return duel!;
}

// ── GET /duels — paginated archive ───────────────────────────────────────────

describe('GET /duels', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    // Seed shared data
    await db.insert(schema.topics).values(TOPIC_NATURE);
    await db.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
    await db.insert(schema.duels).values(DUEL_1);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns paginated list of duels with topicMeta', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      topic: string;
      topicMeta: { id: string | null; label: string };
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('duel-001');
    expect(body[0].topic).toBe('Nature');
    expect(body[0].topicMeta.id).toBe('topic-nature');
    expect(body[0].topicMeta.label).toBe('Nature');
  });

  test('includes topicMeta.id and topicMeta.label when topic join succeeds', async () => {
    const res = await app.request('/?sort=recent');
    const [item] = (await res.json()) as Array<{
      topicMeta: { id: string | null; label: string };
    }>;
    expect(item.topicMeta.id).toBe('topic-nature');
    expect(item.topicMeta.label).toBe('Nature');
  });

  test('computes archive avgReadingTime for the best-case scenario', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-best-case',
      poemAId: 'poem-human-best',
      poemBId: 'poem-ai-best',
      contentA: makeWordContent(1, 'besta'),
      contentB: makeWordContent(1, 'bestb'),
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-best-case').avgReadingTime).toBe('0m 1s');
  });

  test('computes archive avgReadingTime for the average-case scenario', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-average-case',
      poemAId: 'poem-human-average',
      poemBId: 'poem-ai-average',
      contentA: makeWordContent(100, 'averagea'),
      contentB: makeWordContent(100, 'averageb'),
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-average-case').avgReadingTime).toBe('1m 0s');
  });

  test('computes archive avgReadingTime for the worst-case scenario', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-worst-case',
      poemAId: 'poem-human-worst',
      poemBId: 'poem-ai-worst',
      contentA: makeWordContent(1000, 'worsta'),
      contentB: makeWordContent(1000, 'worstb'),
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-worst-case').avgReadingTime).toBe('10m 0s');
  });

  test('computes distinct avgReadingTime values for each archive row in the same response', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-short',
      poemAId: 'poem-human-short',
      poemBId: 'poem-ai-short',
      contentA: makeWordContent(25, 'shorta'),
      contentB: makeWordContent(25, 'shortb'),
    });
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-medium',
      poemAId: 'poem-human-medium',
      poemBId: 'poem-ai-medium',
      contentA: makeWordContent(150, 'mediuma'),
      contentB: makeWordContent(150, 'mediumb'),
    });
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-long',
      poemAId: 'poem-human-long',
      poemBId: 'poem-ai-long',
      contentA: makeWordContent(450, 'longa'),
      contentB: makeWordContent(450, 'longb'),
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-short').avgReadingTime).toBe('0m 15s');
    expect(getArchiveDuel(body, 'duel-medium').avgReadingTime).toBe('1m 30s');
    expect(getArchiveDuel(body, 'duel-long').avgReadingTime).toBe('4m 30s');
  });

  test('normalizes repeated whitespace and newlines when computing archive avgReadingTime', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-whitespace',
      poemAId: 'poem-human-whitespace',
      poemBId: 'poem-ai-whitespace',
      contentA: 'alpha\n\nbeta\ngamma',
      contentB: 'delta     epsilon',
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-whitespace').avgReadingTime).toBe('0m 2s');
  });

  test('rounds archive avgReadingTime consistently around the one-minute threshold', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-199-words',
      poemAId: 'poem-human-199',
      poemBId: 'poem-ai-199',
      contentA: makeWordContent(99, 'threshold199a'),
      contentB: makeWordContent(100, 'threshold199b'),
    });
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-200-words',
      poemAId: 'poem-human-200',
      poemBId: 'poem-ai-200',
      contentA: makeWordContent(100, 'threshold200a'),
      contentB: makeWordContent(100, 'threshold200b'),
    });
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-201-words',
      poemAId: 'poem-human-201',
      poemBId: 'poem-ai-201',
      contentA: makeWordContent(100, 'threshold201a'),
      contentB: makeWordContent(101, 'threshold201b'),
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];

    expect(getArchiveDuel(body, 'duel-199-words').avgReadingTime).toBe('1m 0s');
    expect(getArchiveDuel(body, 'duel-200-words').avgReadingTime).toBe('1m 0s');
    expect(getArchiveDuel(body, 'duel-201-words').avgReadingTime).toBe('1m 0s');
  });

  test('computes archive avgReadingTime independently of vote aggregation', async () => {
    await insertArchiveDuelFixture(db, {
      duelId: 'duel-with-votes',
      poemAId: 'poem-human-votes',
      poemBId: 'poem-ai-votes',
      contentA: makeWordContent(120, 'votea'),
      contentB: makeWordContent(80, 'voteb'),
    });
    await db.insert(schema.votes).values({
      duelId: 'duel-with-votes',
      selectedPoemId: 'poem-human-votes',
      isHuman: true,
      readingTimeMs: 30000,
    });

    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ArchiveDuelRow[];
    const duel = getArchiveDuel(body, 'duel-with-votes');

    expect(duel.humanWinRate).toBe(100);
    expect(duel.avgReadingTime).toBe('1m 0s');
  });

  // Note: topicId is now mandatory (NOT NULL) on duels. The null topicId fallback
  // in buildTopicMeta is kept as defensive code but cannot be triggered via normal inserts.

  test('returns 400 with INVALID_PAGE code for page=0', async () => {
    // Page validation runs before seed validation; seed=42 ensures we reach page check.
    const res = await app.request('/?page=0&seed=42');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_PAGE');
    expect(typeof body.error).toBe('string');
  });

  test('returns 400 with INVALID_PAGE code for negative page', async () => {
    const res = await app.request('/?page=-1&seed=42');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('returns 400 with INVALID_PAGE code for non-integer page', async () => {
    const res = await app.request('/?page=1.5&seed=42');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('returns 400 with INVALID_PAGE code for non-numeric page', async () => {
    const res = await app.request('/?page=abc&seed=42');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('uses page=1 when page query param is absent', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
  });

  test('accepts positive integer page query values', async () => {
    const res = await app.request('/?page=2&sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('serves multiple duel IDs in the same day via GET /duels and GET /duels/:id', async () => {
    await db.insert(schema.poems).values({
      id: 'poem-human-2',
      title: 'Another Human',
      content: 'line one\nline two',
      author: 'Human Author',
      type: 'HUMAN',
    });
    await db.insert(schema.poems).values({
      id: 'poem-ai-2',
      title: 'Another AI',
      content: 'line one\nline two',
      author: 'AI Author',
      type: 'AI',
    });
    await db.insert(schema.duels).values({
      id: 'duel-002',
      topic: 'Nature',
      topicId: 'topic-nature',
      poemAId: 'poem-human-2',
      poemBId: 'poem-ai-2',
    });

    const listRes = await app.request('/?sort=recent');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as Array<{ id: string }>;
    const ids = listBody.map((item) => item.id);
    expect(ids).toContain('duel-001');
    expect(ids).toContain('duel-002');

    const duel1Res = await app.request('/duel-001');
    const duel2Res = await app.request('/duel-002');
    expect(duel1Res.status).toBe(200);
    expect(duel2Res.status).toBe(200);
  });
});

// ── GET /duels?topic_id=... — topic filtering ─────────────────────────────────

describe('GET /duels?topic_id', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    // Two topics
    await db.insert(schema.topics).values([
      { id: 'topic-nature', label: 'Nature' },
      { id: 'topic-love', label: 'Love' },
    ]);
    // Four poems
    await db.insert(schema.poems).values([
      { id: 'p-h1', title: 'H1', content: 'c', author: 'A', type: 'HUMAN' },
      { id: 'p-a1', title: 'A1', content: 'c', author: 'B', type: 'AI' },
      { id: 'p-h2', title: 'H2', content: 'c', author: 'C', type: 'HUMAN' },
      { id: 'p-a2', title: 'A2', content: 'c', author: 'D', type: 'AI' },
    ]);
    // One Nature duel, one Love duel
    await db.insert(schema.duels).values([
      {
        id: 'duel-nature',
        topic: 'Nature',
        topicId: 'topic-nature',
        poemAId: 'p-h1',
        poemBId: 'p-a1',
      },
      { id: 'duel-love', topic: 'Love', topicId: 'topic-love', poemAId: 'p-h2', poemBId: 'p-a2' },
    ]);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns only duels matching the given topic_id', async () => {
    const res = await app.request('/?sort=recent&topic_id=topic-nature');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('duel-nature');
  });

  test('returns empty array when no duels match the topic_id', async () => {
    const res = await app.request('/?sort=recent&topic_id=topic-nonexistent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(0);
  });

  test('returns all duels when topic_id is absent', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(2);
  });

  test('filtered result still includes topicMeta', async () => {
    const res = await app.request('/?sort=recent&topic_id=topic-love');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      id: string;
      topicMeta: { id: string; label: string };
    }>;
    expect(body[0].topicMeta.id).toBe('topic-love');
    expect(body[0].topicMeta.label).toBe('Love');
  });
});

// ── GET /duels/today — deprecated ────────────────────────────────────────────

describe('GET /duels/today', () => {
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

  test('returns 404 with ENDPOINT_NOT_FOUND code', async () => {
    const res = await app.request('/today');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('ENDPOINT_NOT_FOUND');
    expect(typeof body.error).toBe('string');
  });
});

// ── GET /duels/:id — canonical anonymous duel ─────────────────────────────────

describe('GET /duels/:id', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await db.insert(schema.topics).values(TOPIC_NATURE);
    await db.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
    await db.insert(schema.duels).values(DUEL_1);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns anonymous duel payload (no author info) for valid id', async () => {
    const res = await app.request('/duel-001');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      topic: string;
      poemA: Record<string, unknown>;
      poemB: Record<string, unknown>;
    };
    expect(body.id).toBe('duel-001');
    expect(body.topic).toBe('Nature');
    // Anonymous payload must NOT include author or type
    expect(body.poemA.author).toBeUndefined();
    expect(body.poemA.type).toBeUndefined();
    expect(body.poemB.author).toBeUndefined();
    // But must include id, title, content
    expect(body.poemA.id).toBe('poem-human-1');
    expect(typeof body.poemA.title).toBe('string');
    expect(typeof body.poemA.content).toBe('string');
  });

  test('logs a row to featured_duels on each call', async () => {
    await app.request('/duel-001');
    await app.request('/duel-001');

    const rows = await db.select().from(schema.featuredDuels);
    expect(rows).toHaveLength(2);
    expect(rows[0].duelId).toBe('duel-001');
    expect(rows[1].duelId).toBe('duel-001');
  });

  test('still returns duel payload when featured_duels table does not exist', async () => {
    const dbWithoutFeaturedDuels = await createTestDb({ includeFeaturedDuelsTable: false });
    const appWithoutFeaturedDuels = createTestApp(dbWithoutFeaturedDuels);

    try {
      await dbWithoutFeaturedDuels.insert(schema.topics).values(TOPIC_NATURE);
      await dbWithoutFeaturedDuels.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
      await dbWithoutFeaturedDuels.insert(schema.duels).values(DUEL_1);

      const res = await appWithoutFeaturedDuels.request('/duel-001');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBe('duel-001');
    } finally {
      // @ts-expect-error – accessing internal client for cleanup
      await dbWithoutFeaturedDuels.$client.close();
    }
  });

  test('returns 404 with DUEL_NOT_FOUND code when duel does not exist', async () => {
    const res = await app.request('/nonexistent-duel');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Duel not found');
    expect(body.code).toBe('DUEL_NOT_FOUND');
  });

  test('returns 404 with DUEL_NOT_FOUND when duel exists but poem row is missing', async () => {
    // Insert a duel referencing a poem that does not exist in the poems table.
    // We bypass FK to simulate a missing poem (use raw SQL to insert the duel
    // after disabling FKs).
    await db.insert(schema.poems).values({
      id: 'poem-orphan-a',
      title: 'Orphan A',
      content: 'x',
      author: 'X',
      type: 'HUMAN',
    });
    await db.insert(schema.poems).values({
      id: 'poem-orphan-b',
      title: 'Orphan B',
      content: 'y',
      author: 'Y',
      type: 'AI',
    });
    await db.insert(schema.duels).values({
      id: 'duel-orphan',
      topic: 'Nature',
      topicId: 'topic-nature',
      poemAId: 'poem-orphan-a',
      poemBId: 'poem-orphan-b',
    });
    // Disable FK constraints to simulate a broken-reference state, then delete the poem
    // @ts-expect-error – accessing internal client for raw SQL
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    // @ts-expect-error – accessing internal client for raw SQL
    await db.$client.execute('DELETE FROM poems WHERE id = ?', ['poem-orphan-a']);
    // @ts-expect-error – accessing internal client for raw SQL
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const res = await app.request('/duel-orphan');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Duel not found');
    expect(body.code).toBe('DUEL_NOT_FOUND');
  });
});

// ── GET /duels/:id/stats ──────────────────────────────────────────────────────

describe('GET /duels/:id/stats', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await db.insert(schema.topics).values(TOPIC_NATURE);
    await db.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
    await db.insert(schema.duels).values(DUEL_1);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns 404 with DUEL_NOT_FOUND when duel does not exist', async () => {
    const res = await app.request('/nonexistent/stats');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('Duel not found');
    expect(body.code).toBe('DUEL_NOT_FOUND');
  });

  test('returns 404 with DUEL_NOT_FOUND when duel references a missing poem', async () => {
    await db.insert(schema.poems).values({
      id: 'poem-ghost-a',
      title: 'Ghost A',
      content: 'x',
      author: 'X',
      type: 'HUMAN',
    });
    await db.insert(schema.poems).values({
      id: 'poem-ghost-b',
      title: 'Ghost B',
      content: 'y',
      author: 'Y',
      type: 'AI',
    });
    await db.insert(schema.duels).values({
      id: 'duel-ghost',
      topic: 'Nature',
      topicId: 'topic-nature',
      poemAId: 'poem-ghost-a',
      poemBId: 'poem-ghost-b',
    });
    // Disable FK constraints to simulate a missing poem row
    // @ts-expect-error – raw SQL to break FK
    await db.$client.execute('PRAGMA foreign_keys = OFF');
    // @ts-expect-error – raw SQL to break FK
    await db.$client.execute('DELETE FROM poems WHERE id = ?', ['poem-ghost-b']);
    // @ts-expect-error – raw SQL to break FK
    await db.$client.execute('PRAGMA foreign_keys = ON');

    const res = await app.request('/duel-ghost/stats');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('DUEL_NOT_FOUND');
  });

  test('includes topicMeta in duel payload', async () => {
    const res = await app.request('/duel-001/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      duel: { topicMeta: { id: string | null; label: string } };
    };
    expect(body.duel.topicMeta.id).toBe('topic-nature');
    expect(body.duel.topicMeta.label).toBe('Nature');
  });

  test('includes sourceInfo with primary and provenances for both poems', async () => {
    // Add a scrape source for the human poem
    await db.insert(schema.scrapeSources).values({
      id: 'scrape-1',
      poemId: 'poem-human-1',
      source: 'Poetry Foundation',
      sourceUrl: 'https://poetryfoundation.org/poem/road',
      scrapedAt: '2024-01-01T00:00:00.000Z',
      isPublicDomain: true,
    });

    const res = await app.request('/duel-001/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      duel: {
        poemA: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
        poemB: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
      };
    };

    // poemA (human) — has primary source from poem row + 1 scrape provenance
    expect(body.duel.poemA.sourceInfo.primary.source).toBe('Poetry Foundation');
    expect(body.duel.poemA.sourceInfo.primary.sourceUrl).toBe(
      'https://poetryfoundation.org/poem/road',
    );
    expect(body.duel.poemA.sourceInfo.provenances).toHaveLength(1);

    // poemB (AI) — no scrape source rows; provenances should be an empty array
    expect(body.duel.poemB.sourceInfo.provenances).toHaveLength(0);
    expect(body.duel.poemB.sourceInfo.primary.source).toBeNull();
    expect(body.duel.poemB.sourceInfo.primary.sourceUrl).toBeNull();
  });

  test('returns provenances sorted by scrapedAt descending', async () => {
    await db.insert(schema.scrapeSources).values([
      {
        id: 'scrape-old',
        poemId: 'poem-human-1',
        source: 'Old Source',
        sourceUrl: 'https://old.example.com',
        scrapedAt: '2023-01-01T00:00:00.000Z',
        isPublicDomain: true,
      },
      {
        id: 'scrape-new',
        poemId: 'poem-human-1',
        source: 'New Source',
        sourceUrl: 'https://new.example.com',
        scrapedAt: '2024-06-01T00:00:00.000Z',
        isPublicDomain: true,
      },
    ]);

    const res = await app.request('/duel-001/stats');
    const body = (await res.json()) as {
      duel: { poemA: { sourceInfo: { provenances: Array<{ scrapedAt: string }> } } };
    };
    const provenances = body.duel.poemA.sourceInfo.provenances;
    expect(provenances).toHaveLength(2);
    // Most recent first
    expect(provenances[0].scrapedAt).toBe('2024-06-01T00:00:00.000Z');
    expect(provenances[1].scrapedAt).toBe('2023-01-01T00:00:00.000Z');
  });

  test('allows AI poems to return empty sourceInfo.provenances', async () => {
    const res = await app.request('/duel-001/stats');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      duel: { poemB: { sourceInfo: { provenances: unknown[] } } };
    };
    expect(body.duel.poemB.sourceInfo.provenances).toEqual([]);
  });

  test('returns humanWinRate and avgReadingTime', async () => {
    // Cast a vote for the human poem
    await db.insert(schema.votes).values({
      duelId: 'duel-001',
      selectedPoemId: 'poem-human-1',
      isHuman: true,
      readingTimeMs: 30000,
    });

    const res = await app.request('/duel-001/stats');
    const body = (await res.json()) as {
      humanWinRate: number;
      avgReadingTime: string;
    };
    expect(body.humanWinRate).toBe(100);
    expect(typeof body.avgReadingTime).toBe('string');
  });
});

// ── GET /duels seed parameter validation ─────────────────────────────────────

describe('GET /duels seed validation', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await db.insert(schema.topics).values(TOPIC_NATURE);
    await db.insert(schema.poems).values([POEM_HUMAN, POEM_AI]);
    await db.insert(schema.duels).values(DUEL_1);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('returns 400 MISSING_SEED when neither seed nor sort=recent is provided', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('MISSING_SEED');
    expect(typeof body.error).toBe('string');
  });

  test('returns 400 INVALID_SEED for negative seed', async () => {
    const res = await app.request('/?seed=-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SEED');
  });

  test('returns 400 INVALID_SEED for non-integer seed (decimal)', async () => {
    const res = await app.request('/?seed=1.5');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SEED');
  });

  test('returns 400 INVALID_SEED for non-numeric seed string', async () => {
    const res = await app.request('/?seed=abc');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SEED');
  });

  test('returns 400 INVALID_SEED for unsafe integer seed', async () => {
    const res = await app.request('/?seed=9007199254740992');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_SEED');
  });

  test('returns 200 with valid non-negative integer seed', async () => {
    const res = await app.request('/?seed=42');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('returns 200 with seed=0', async () => {
    const res = await app.request('/?seed=0');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('sort=recent bypasses the seed requirement', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(Array.isArray(body)).toBe(true);
  });

  test('INVALID_SEED and MISSING_SEED responses include { error, code } envelope', async () => {
    const missingSeed = await app.request('/');
    const missBody = (await missingSeed.json()) as { error: unknown; code: unknown };
    expect(Object.keys(missBody).sort()).toEqual(['code', 'error']);
    expect(typeof missBody.error).toBe('string');
    expect(missBody.code).toBe('MISSING_SEED');

    const invalidSeed = await app.request('/?seed=-5');
    const invBody = (await invalidSeed.json()) as { error: unknown; code: unknown };
    expect(Object.keys(invBody).sort()).toEqual(['code', 'error']);
    expect(typeof invBody.error).toBe('string');
    expect(invBody.code).toBe('INVALID_SEED');
  });
});

// ── GET /duels seeded ordering ────────────────────────────────────────────────

/** Inserts N duels with deterministic hex-spanning IDs for ordering tests. */
async function insertSpanningDuels(db: TestDb, count: number): Promise<string[]> {
  const step = Math.floor(0xffffffffffff / (count - 1));
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const hex = (step * i).toString(16).padStart(12, '0');
    const duelId = `duel-${hex}`;
    ids.push(duelId);
    const poemAId = `poem-h-${i}`;
    const poemBId = `poem-a-${i}`;
    await db.insert(schema.poems).values([
      { id: poemAId, title: `H${i}`, content: 'x', author: `A${i}`, type: 'HUMAN' },
      { id: poemBId, title: `AI${i}`, content: 'y', author: `B${i}`, type: 'AI' },
    ]);
    await db.insert(schema.duels).values({
      id: duelId,
      topic: 'Nature',
      topicId: 'topic-nature',
      poemAId,
      poemBId,
    });
  }
  return ids;
}

describe('GET /duels seeded ordering', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await db.insert(schema.topics).values(TOPIC_NATURE);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('same seed returns the same first-page ordering across repeated requests', async () => {
    await insertSpanningDuels(db, 5);

    const res1 = await app.request('/?seed=42');
    const res2 = await app.request('/?seed=42');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
    const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
    expect(ids1).toEqual(ids2);
  });

  test('different seeds shift the first-page ordering when enough duels exist', async () => {
    await insertSpanningDuels(db, 16);

    const res1 = await app.request('/?seed=1');
    const res2 = await app.request('/?seed=999999');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
    const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
    // With 16 duels spanning the full hex range, two seeds will almost certainly
    // produce different pivot positions, yielding a distinct page-1 ordering.
    expect(ids1).not.toEqual(ids2);
  });

  test('seeded pagination does not repeat IDs across page boundaries', async () => {
    await insertSpanningDuels(db, 14); // 12 on page 1, 2 on page 2

    const res1 = await app.request('/?seed=42&page=1');
    const res2 = await app.request('/?seed=42&page=2');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
    const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);

    expect(ids1).toHaveLength(12);
    expect(ids2.length).toBeGreaterThan(0);

    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });
});

// ── GET /duels sort=recent bypass ─────────────────────────────────────────────

describe('GET /duels sort=recent bypass', () => {
  let db: TestDb;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    app = createTestApp(db);
    await db.insert(schema.topics).values([
      { id: 'topic-nature', label: 'Nature' },
      { id: 'topic-love', label: 'Love' },
    ]);
    await db.insert(schema.poems).values([
      { id: 'ph1', title: 'H1', content: 'c', author: 'A', type: 'HUMAN' },
      { id: 'pa1', title: 'A1', content: 'c', author: 'B', type: 'AI' },
      { id: 'ph2', title: 'H2', content: 'c', author: 'C', type: 'HUMAN' },
      { id: 'pa2', title: 'A2', content: 'c', author: 'D', type: 'AI' },
    ]);
    await db.insert(schema.duels).values([
      { id: 'duel-nat', topic: 'Nature', topicId: 'topic-nature', poemAId: 'ph1', poemBId: 'pa1' },
      { id: 'duel-luv', topic: 'Love', topicId: 'topic-love', poemAId: 'ph2', poemBId: 'pa2' },
    ]);
  });

  afterEach(async () => {
    // @ts-expect-error – accessing internal client for cleanup
    await db.$client.close();
  });

  test('sort=recent returns 200 without seed', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
  });

  test('sort=recent still supports topic_id filtering', async () => {
    const res = await app.request('/?sort=recent&topic_id=topic-nature');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; topicMeta: { id: string } }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('duel-nat');
    expect(body[0].topicMeta.id).toBe('topic-nature');
  });

  test('sort=recent returns all duels when no topic filter is given', async () => {
    const res = await app.request('/?sort=recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(2);
    const ids = body.map((d) => d.id);
    expect(ids).toContain('duel-nat');
    expect(ids).toContain('duel-luv');
  });
});

describe('duels API error envelope', () => {
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

  test('returns stable { error, code } for in-scope error paths', async () => {
    const scenarios: Array<{ path: string; status: number; code: string }> = [
      // seed=42 ensures the page validation error fires (page is validated before seed)
      { path: '/?page=abc&seed=42', status: 400, code: 'INVALID_PAGE' },
      { path: '/', status: 400, code: 'MISSING_SEED' },
      { path: '/?seed=-1', status: 400, code: 'INVALID_SEED' },
      { path: '/today', status: 404, code: 'ENDPOINT_NOT_FOUND' },
      { path: '/missing-duel-id', status: 404, code: 'DUEL_NOT_FOUND' },
      { path: '/missing-duel-id/stats', status: 404, code: 'DUEL_NOT_FOUND' },
    ];

    for (const scenario of scenarios) {
      const res = await app.request(scenario.path);
      expect(res.status).toBe(scenario.status);

      const body = (await res.json()) as { error: unknown; code: unknown };
      expect(Object.keys(body).sort()).toEqual(['code', 'error']);
      expect(typeof body.error).toBe('string');
      expect(body.code).toBe(scenario.code);
    }
  });
});
