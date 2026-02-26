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
      topic_id TEXT REFERENCES topics(id),
      poem_a_id TEXT NOT NULL REFERENCES poems(id),
      poem_b_id TEXT NOT NULL REFERENCES poems(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    `CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      duel_id TEXT NOT NULL REFERENCES duels(id),
      selected_poem_id TEXT NOT NULL REFERENCES poems(id),
      is_human INTEGER NOT NULL,
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
    const res = await app.request('/');
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
    const res = await app.request('/');
    const [item] = (await res.json()) as Array<{
      topicMeta: { id: string | null; label: string };
    }>;
    expect(item.topicMeta.id).toBe('topic-nature');
    expect(item.topicMeta.label).toBe('Nature');
  });

  test('falls back to topicMeta: { id: null, label: duel.topic } when topic_id is null', async () => {
    // Insert a duel without a topic_id
    await db.insert(schema.poems).values({
      id: 'poem-human-2',
      title: 'Orphan Poem',
      content: 'lonely text',
      author: 'Anon',
      type: 'HUMAN',
    });
    await db.insert(schema.poems).values({
      id: 'poem-ai-2',
      title: 'AI Orphan',
      content: 'lonely ai',
      author: 'GPT',
      type: 'AI',
    });
    await db.insert(schema.duels).values({
      id: 'duel-002',
      topic: 'Orphan Topic',
      topicId: null,
      poemAId: 'poem-human-2',
      poemBId: 'poem-ai-2',
    });

    const res = await app.request('/');
    const items = (await res.json()) as Array<{
      id: string;
      topicMeta: { id: string | null; label: string };
    }>;
    const orphan = items.find((i) => i.id === 'duel-002');
    expect(orphan).toBeDefined();
    expect(orphan!.topicMeta.id).toBeNull();
    expect(orphan!.topicMeta.label).toBe('Orphan Topic');
  });

  test('returns 400 with INVALID_PAGE code for page=0', async () => {
    const res = await app.request('/?page=0');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('INVALID_PAGE');
    expect(typeof body.error).toBe('string');
  });

  test('returns 400 with INVALID_PAGE code for negative page', async () => {
    const res = await app.request('/?page=-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('returns 400 with INVALID_PAGE code for non-integer page', async () => {
    const res = await app.request('/?page=1.5');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('returns 400 with INVALID_PAGE code for non-numeric page', async () => {
    const res = await app.request('/?page=abc');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_PAGE');
  });

  test('uses page=1 when page query param is absent', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
  });

  test('accepts positive integer page query values', async () => {
    const res = await app.request('/?page=2');
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

    const listRes = await app.request('/');
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
    const res = await app.request('/?topic_id=topic-nature');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('duel-nature');
  });

  test('returns empty array when no duels match the topic_id', async () => {
    const res = await app.request('/?topic_id=topic-nonexistent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(0);
  });

  test('returns all duels when topic_id is absent', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(2);
  });

  test('filtered result still includes topicMeta', async () => {
    const res = await app.request('/?topic_id=topic-love');
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
      topic: 'Orphan',
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
      topic: 'Ghost',
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
      { path: '/?page=abc', status: 400, code: 'INVALID_PAGE' },
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
