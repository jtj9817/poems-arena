#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 3: API Updates
 * Generated: 2026-02-25
 * Purpose: Verify GET /duels (topicMeta, page validation), GET /duels/today
 *          (ENDPOINT_NOT_FOUND), GET /duels/:id (featured_duels logging,
 *          anonymous payload, DUEL_NOT_FOUND), and GET /duels/:id/stats
 *          (topicMeta, sourceInfo) for Phase 5 — Duel Assembly & API Updates.
 *
 * Run with: bun scripts/verify-phase3-api-updates.ts
 *
 * NOTE: uses `createDb` from packages/db (not @libsql/client directly) and
 * calls `createDuelsRouter(db).fetch()` to avoid workspace-root module
 * resolution issues (pnpm strict isolation).
 */

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { createDuelsRouter } from '../apps/api/src/routes/duels';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase3_api_updates_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const tmpDir = process.env.TMPDIR ?? '/tmp';
const dbWorkDir = path.join(tmpDir, 'sanctuary_manual_tests');
const dbFile = path.join(dbWorkDir, `${testRunId}.sqlite`);

// Short run-scoped suffix to avoid ID collisions when reusing an external DB.
const shortId = testRunId.slice(-16).replace(/[^a-zA-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type CheckFn = () => void | Promise<void>;

function getAssertionFailureCount(): number {
  const state = TestAssertion as unknown as { failed?: number };
  return typeof state.failed === 'number' ? state.failed : 0;
}

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  TestLogger.startPhase(name);
  try {
    const failuresBefore = getAssertionFailureCount();
    await fn();
    const failuresAfter = getAssertionFailureCount();
    if (failuresAfter > failuresBefore) {
      TestLogger.error(`FAIL: ${name}`, { assertionFailures: failuresAfter - failuresBefore });
      return false;
    }
    TestLogger.endPhase(name);
    return true;
  } catch (error) {
    TestLogger.error(`FAIL: ${name}`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function runCommand(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(args, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Test DB helpers
//
// Uses createDb from packages/db (which owns @libsql/client) + raw SQL DDL
// via db.$client.execute() so this script has no direct @libsql/client dep.
// ---------------------------------------------------------------------------

type TestDb = ReturnType<typeof createDb>;

const SCHEMA_DDL = [
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
  `CREATE TABLE IF NOT EXISTS featured_duels (
     id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
     duel_id TEXT NOT NULL REFERENCES duels(id),
     featured_on TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   )`,
];

async function createTestDb(opts: { withFeaturedDuels?: boolean } = {}): Promise<TestDb> {
  const { withFeaturedDuels = true } = opts;
  // Each anonymous in-memory connection is isolated — no ?cache param needed.
  const db = createDb({ url: 'file::memory:' });
  const ddl = withFeaturedDuels ? SCHEMA_DDL : SCHEMA_DDL.slice(0, -1);
  for (const stmt of ddl) {
    // @ts-expect-error – $client is the raw LibSQL client; execute() accepts plain SQL string
    await db.$client.execute(stmt);
  }
  return db;
}

async function closeTestDb(db: TestDb): Promise<void> {
  // @ts-expect-error – accessing internal client for cleanup
  await db.$client.close();
}

/**
 * Seed the base data (1 topic, 2 poems, 1 duel) into a test DB.
 * Uses unique IDs scoped to the current test run to avoid collisions.
 */
async function seedBase(db: TestDb, prefix: string) {
  // @ts-expect-error – $client raw execute for seeding
  const raw = db.$client;
  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
    args: [`${prefix}_topic_nature`, 'Nature'],
  });
  await raw.execute({
    sql: 'INSERT INTO poems (id, title, content, author, type, year, source, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [
      `${prefix}_human_1`,
      'The Road Not Taken',
      'Two roads diverged in a yellow wood',
      'Robert Frost',
      'HUMAN',
      '1916',
      'Poetry Foundation',
      'https://poetryfoundation.org/poem/road',
    ],
  });
  await raw.execute({
    sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
    args: [
      `${prefix}_ai_1`,
      'Generated Verse',
      'A machine contemplates the autumn leaves',
      'Claude 3 Opus',
      'AI',
    ],
  });
  await raw.execute({
    sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
    args: [
      `${prefix}_duel_001`,
      'Nature',
      `${prefix}_topic_nature`,
      `${prefix}_human_1`,
      `${prefix}_ai_1`,
    ],
  });
  return {
    topicId: `${prefix}_topic_nature`,
    humanId: `${prefix}_human_1`,
    aiId: `${prefix}_ai_1`,
    duelId: `${prefix}_duel_001`,
  };
}

/**
 * Send a request to the duels router.
 * Uses `createDuelsRouter(db).fetch()` — Hono routers expose a fetch handler,
 * so we avoid needing `new Hono()` (which would require a direct hono import
 * unavailable at the workspace root under pnpm strict isolation).
 */
async function routerFetch(db: TestDb, path: string): Promise<Response> {
  const router = createDuelsRouter(db);
  return router.fetch(new Request(`http://localhost${path}`));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 3 — API Updates ===', { testRunId, logFile });

  let passed = 0;
  let failed = 0;
  function tally(result: boolean): void {
    if (result) passed++;
    else failed++;
  }

  // =========================================================================
  // SECTION A: File-system + export checks
  // =========================================================================

  TestLogger.info('--- Section A: Required files and exports ---');

  tally(
    await runCheck('A1: apps/api/src/errors.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/api/src/errors.ts')),
        'errors.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A2: apps/api/src/routes/duels.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/api/src/routes/duels.ts')),
        'duels.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A3: apps/api/src/routes/duels.test.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/api/src/routes/duels.test.ts')),
        'duels.test.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A4: createDuelsRouter is an exported function', () => {
      TestAssertion.assertTrue(
        typeof createDuelsRouter === 'function',
        'createDuelsRouter must be a function',
      );
    }),
  );

  // =========================================================================
  // SECTION B: GET /duels — topicMeta and page validation
  // =========================================================================

  TestLogger.info('--- Section B: GET /duels — topicMeta and page validation ---');

  tally(
    await runCheck('B1: GET /duels returns topicMeta with topic join', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `b1_${shortId}`);
        const res = await routerFetch(db, '/');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as Array<{
          id: string;
          topicMeta: { id: string | null; label: string };
        }>;
        const duel = body.find((d) => d.id === ids.duelId);
        TestAssertion.assertNotNull(duel, 'seeded duel must appear in list');
        TestAssertion.assertEquals(
          ids.topicId,
          duel!.topicMeta.id,
          'topicMeta.id must equal topic id',
        );
        TestAssertion.assertEquals(
          'Nature',
          duel!.topicMeta.label,
          'topicMeta.label must equal topic label',
        );
        TestLogger.info('B1 topicMeta', duel!.topicMeta);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'B2: GET /duels topicMeta falls back to { id: null, label: duel.topic } when topic_id is null',
      async () => {
        const db = await createTestDb();
        try {
          // @ts-expect-error – raw execute
          const raw = db.$client;
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`b2h_${shortId}`, 'Orphan H', 'x', 'A', 'HUMAN'],
          });
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`b2a_${shortId}`, 'Orphan AI', 'y', 'B', 'AI'],
          });
          await raw.execute({
            sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, NULL, ?, ?)',
            args: [`b2_duel_${shortId}`, 'Lost Theme', `b2h_${shortId}`, `b2a_${shortId}`],
          });

          const res = await routerFetch(db, '/');
          TestAssertion.assertEquals(200, res.status, 'status must be 200');
          const body = (await res.json()) as Array<{
            id: string;
            topicMeta: { id: string | null; label: string };
          }>;
          const duel = body.find((d) => d.id === `b2_duel_${shortId}`);
          TestAssertion.assertNotNull(duel, 'orphan duel must appear in list');
          TestAssertion.assertEquals(null, duel!.topicMeta.id, 'topicMeta.id must be null');
          TestAssertion.assertEquals(
            'Lost Theme',
            duel!.topicMeta.label,
            'topicMeta.label must fall back to duel.topic',
          );
          TestLogger.info('B2 orphan topicMeta', duel!.topicMeta);
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  for (const [label, pageQuery] of [
    ['B3: page=0', '/?page=0'],
    ['B4: page=-1', '/?page=-1'],
    ['B5: page=1.5 (non-integer)', '/?page=1.5'],
    ['B6: page=abc (non-numeric)', '/?page=abc'],
  ] as const) {
    tally(
      await runCheck(`${label} → 400 INVALID_PAGE`, async () => {
        const db = await createTestDb();
        try {
          const res = await routerFetch(db, pageQuery);
          TestAssertion.assertEquals(400, res.status, `status must be 400 for ${pageQuery}`);
          const body = (await res.json()) as { code: string; error: string };
          TestAssertion.assertEquals('INVALID_PAGE', body.code, 'code must be INVALID_PAGE');
          TestAssertion.assertTrue(typeof body.error === 'string', 'error must be a string');
        } finally {
          await closeTestDb(db);
        }
      }),
    );
  }

  // =========================================================================
  // SECTION C: GET /duels/today — deprecated ENDPOINT_NOT_FOUND
  // =========================================================================

  TestLogger.info('--- Section C: GET /duels/today — ENDPOINT_NOT_FOUND ---');

  tally(
    await runCheck('C1: GET /duels/today returns 404 ENDPOINT_NOT_FOUND', async () => {
      const db = await createTestDb();
      try {
        const res = await routerFetch(db, '/today');
        TestAssertion.assertEquals(404, res.status, 'status must be 404');
        const body = (await res.json()) as { error: string; code: string };
        TestAssertion.assertEquals(
          'ENDPOINT_NOT_FOUND',
          body.code,
          'code must be ENDPOINT_NOT_FOUND',
        );
        TestAssertion.assertTrue(typeof body.error === 'string', 'error must be a string');
        TestLogger.info('C1 body', body);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION D: GET /duels/:id — featured_duels logging and error handling
  // =========================================================================

  TestLogger.info('--- Section D: GET /duels/:id ---');

  tally(
    await runCheck(
      'D1: returns anonymous payload (id, title, content — no author/type)',
      async () => {
        const db = await createTestDb();
        try {
          const ids = await seedBase(db, `d1_${shortId}`);
          const res = await routerFetch(db, `/${ids.duelId}`);
          TestAssertion.assertEquals(200, res.status, 'status must be 200');
          const body = (await res.json()) as {
            id: string;
            topic: string;
            poemA: Record<string, unknown>;
            poemB: Record<string, unknown>;
          };
          TestAssertion.assertEquals(ids.duelId, body.id, 'id must match');
          TestAssertion.assertEquals('Nature', body.topic, 'topic must match');
          TestAssertion.assertTrue(typeof body.poemA.id === 'string', 'poemA.id must be present');
          TestAssertion.assertTrue(
            typeof body.poemA.title === 'string',
            'poemA.title must be present',
          );
          TestAssertion.assertTrue(
            body.poemA.author === undefined || body.poemA.author === null,
            'poemA.author must NOT be exposed in anonymous payload',
          );
          TestAssertion.assertTrue(
            body.poemA.type === undefined || body.poemA.type === null,
            'poemA.type must NOT be exposed in anonymous payload',
          );
          TestLogger.info('D1 poemA keys', { keys: Object.keys(body.poemA) });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'D2: appends a featured_duels row on each call (two calls → two rows)',
      async () => {
        const db = await createTestDb();
        try {
          const ids = await seedBase(db, `d2_${shortId}`);
          await routerFetch(db, `/${ids.duelId}`);
          await routerFetch(db, `/${ids.duelId}`);
          // @ts-expect-error – raw client
          const result = await db.$client.execute({
            sql: 'SELECT COUNT(*) as cnt FROM featured_duels WHERE duel_id = ?',
            args: [ids.duelId],
          });
          const count = Number((result.rows[0] as Record<string, unknown>)['cnt']);
          TestAssertion.assertEquals(2, count, 'featured_duels must have 2 rows after 2 calls');
          TestLogger.info('D2 featured_duels count', { count, duelId: ids.duelId });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck('D3: returns 404 DUEL_NOT_FOUND for unknown duel id', async () => {
      const db = await createTestDb();
      try {
        const res = await routerFetch(db, '/nonexistent-duel-id');
        TestAssertion.assertEquals(404, res.status, 'status must be 404');
        const body = (await res.json()) as { error: string; code: string };
        TestAssertion.assertEquals('Duel not found', body.error, 'error message must match');
        TestAssertion.assertEquals('DUEL_NOT_FOUND', body.code, 'code must be DUEL_NOT_FOUND');
        TestLogger.info('D3 body', body);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'D4: returns 404 DUEL_NOT_FOUND when referenced poem row is missing',
      async () => {
        const db = await createTestDb();
        try {
          // @ts-expect-error – raw client
          const raw = db.$client;
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`d4ha_${shortId}`, 'A', 'x', 'A', 'HUMAN'],
          });
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`d4ab_${shortId}`, 'B', 'y', 'B', 'AI'],
          });
          await raw.execute({
            sql: 'INSERT INTO duels (id, topic, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?)',
            args: [`d4_duel_${shortId}`, 'Broken', `d4ha_${shortId}`, `d4ab_${shortId}`],
          });
          await raw.execute('PRAGMA foreign_keys = OFF');
          await raw.execute({ sql: 'DELETE FROM poems WHERE id = ?', args: [`d4ha_${shortId}`] });
          await raw.execute('PRAGMA foreign_keys = ON');

          const res = await routerFetch(db, `/d4_duel_${shortId}`);
          TestAssertion.assertEquals(404, res.status, 'status must be 404');
          const body = (await res.json()) as { code: string };
          TestAssertion.assertEquals('DUEL_NOT_FOUND', body.code, 'code must be DUEL_NOT_FOUND');
          TestLogger.info('D4 missing-poem 404 confirmed');
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'D5: returns 200 (graceful degradation) when featured_duels table is absent',
      async () => {
        const db = await createTestDb({ withFeaturedDuels: false });
        try {
          const ids = await seedBase(db, `d5_${shortId}`);
          const res = await routerFetch(db, `/${ids.duelId}`);
          TestAssertion.assertEquals(
            200,
            res.status,
            'status must be 200 even without featured_duels table',
          );
          const body = (await res.json()) as { id: string };
          TestAssertion.assertEquals(ids.duelId, body.id, 'duel id must match');
          TestLogger.info('D5 graceful degradation confirmed');
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  // =========================================================================
  // SECTION E: GET /duels/:id/stats — topicMeta and sourceInfo
  // =========================================================================

  TestLogger.info('--- Section E: GET /duels/:id/stats ---');

  tally(
    await runCheck('E1: returns 404 DUEL_NOT_FOUND for unknown duel id', async () => {
      const db = await createTestDb();
      try {
        const res = await routerFetch(db, '/nonexistent-id/stats');
        TestAssertion.assertEquals(404, res.status, 'status must be 404');
        const body = (await res.json()) as { code: string };
        TestAssertion.assertEquals('DUEL_NOT_FOUND', body.code, 'code must be DUEL_NOT_FOUND');
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('E2: includes topicMeta in duel payload', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `e2_${shortId}`);
        const res = await routerFetch(db, `/${ids.duelId}/stats`);
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as {
          duel: { topicMeta: { id: string | null; label: string } };
        };
        TestAssertion.assertEquals(
          ids.topicId,
          body.duel.topicMeta.id,
          'topicMeta.id must equal topic id',
        );
        TestAssertion.assertEquals(
          'Nature',
          body.duel.topicMeta.label,
          'topicMeta.label must equal topic label',
        );
        TestLogger.info('E2 topicMeta', body.duel.topicMeta);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'E3: includes sourceInfo.primary and sourceInfo.provenances for both poems',
      async () => {
        const db = await createTestDb();
        try {
          const ids = await seedBase(db, `e3_${shortId}`);
          // @ts-expect-error – raw client
          await db.$client.execute({
            sql: 'INSERT INTO scrape_sources (id, poem_id, source, source_url, scraped_at, is_public_domain) VALUES (?, ?, ?, ?, ?, ?)',
            args: [
              `ss_e3_${shortId}`,
              ids.humanId,
              'Poetry Foundation',
              'https://poetryfoundation.org/poem/road',
              '2024-03-01T00:00:00.000Z',
              1,
            ],
          });
          const res = await routerFetch(db, `/${ids.duelId}/stats`);
          TestAssertion.assertEquals(200, res.status, 'status must be 200');
          const body = (await res.json()) as {
            duel: {
              poemA: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
              poemB: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
            };
          };
          TestAssertion.assertEquals(
            'Poetry Foundation',
            body.duel.poemA.sourceInfo.primary.source as string,
            'poemA primary.source must come from poems.source',
          );
          TestAssertion.assertCount(
            1,
            body.duel.poemA.sourceInfo.provenances,
            'poemA must have 1 provenance',
          );
          TestAssertion.assertCount(
            0,
            body.duel.poemB.sourceInfo.provenances,
            'AI poemB must have 0 provenances',
          );
          TestLogger.info('E3 poemA sourceInfo', body.duel.poemA.sourceInfo);
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'E4: provenances are sorted by scrapedAt descending (newest first)',
      async () => {
        const db = await createTestDb();
        try {
          const ids = await seedBase(db, `e4_${shortId}`);
          // @ts-expect-error – raw client
          const raw = db.$client;
          await raw.execute({
            sql: 'INSERT INTO scrape_sources (id, poem_id, source, source_url, scraped_at, is_public_domain) VALUES (?, ?, ?, ?, ?, ?)',
            args: [
              `ss_e4_old_${shortId}`,
              ids.humanId,
              'Old Source',
              'https://old.example.com',
              '2023-01-01T00:00:00.000Z',
              1,
            ],
          });
          await raw.execute({
            sql: 'INSERT INTO scrape_sources (id, poem_id, source, source_url, scraped_at, is_public_domain) VALUES (?, ?, ?, ?, ?, ?)',
            args: [
              `ss_e4_new_${shortId}`,
              ids.humanId,
              'New Source',
              'https://new.example.com',
              '2024-06-01T00:00:00.000Z',
              1,
            ],
          });
          const res = await routerFetch(db, `/${ids.duelId}/stats`);
          const body = (await res.json()) as {
            duel: { poemA: { sourceInfo: { provenances: Array<{ scrapedAt: string }> } } };
          };
          const p = body.duel.poemA.sourceInfo.provenances;
          TestAssertion.assertCount(2, p, 'poemA must have 2 provenances');
          TestAssertion.assertEquals(
            '2024-06-01T00:00:00.000Z',
            p[0]!.scrapedAt,
            'first provenance must be most recent',
          );
          TestAssertion.assertEquals(
            '2023-01-01T00:00:00.000Z',
            p[1]!.scrapedAt,
            'second provenance must be oldest',
          );
          TestLogger.info('E4 provenance order', {
            first: p[0]!.scrapedAt,
            second: p[1]!.scrapedAt,
          });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'E5: returns 404 DUEL_NOT_FOUND when referenced poem row is missing',
      async () => {
        const db = await createTestDb();
        try {
          // @ts-expect-error – raw client
          const raw = db.$client;
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`e5ha_${shortId}`, 'A', 'x', 'A', 'HUMAN'],
          });
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`e5ab_${shortId}`, 'B', 'y', 'B', 'AI'],
          });
          await raw.execute({
            sql: 'INSERT INTO duels (id, topic, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?)',
            args: [`e5_duel_${shortId}`, 'Broken Stats', `e5ha_${shortId}`, `e5ab_${shortId}`],
          });
          await raw.execute('PRAGMA foreign_keys = OFF');
          await raw.execute({ sql: 'DELETE FROM poems WHERE id = ?', args: [`e5ab_${shortId}`] });
          await raw.execute('PRAGMA foreign_keys = ON');
          const res = await routerFetch(db, `/e5_duel_${shortId}/stats`);
          TestAssertion.assertEquals(404, res.status, 'status must be 404');
          const body = (await res.json()) as { code: string };
          TestAssertion.assertEquals('DUEL_NOT_FOUND', body.code, 'code must be DUEL_NOT_FOUND');
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  // =========================================================================
  // SECTION F: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section F: Automated test suite ---');

  tally(
    await runCheck('F1: pnpm --filter @sanctuary/api test exits 0', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/api', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('F1 test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('F1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/api test suite must exit 0');
    }),
  );

  // =========================================================================
  // Summary
  // =========================================================================

  const assertionsPassed = TestAssertion.summary();
  const checksPassed = failed === 0;
  const allPassed = assertionsPassed && checksPassed;
  const total = passed + failed;

  // Cleanup temp DB file if we created one
  if (existsSync(dbFile)) {
    try {
      rmSync(dbFile, { force: true });
    } catch {
      // best-effort
    }
  }

  TestLogger.info('=== Manual Test Completed ===', { passed, failed, total });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Test ID  : ${testRunId}`);
  console.log(`  Checks   : ${passed}/${total} passed`);
  console.log(
    `  Result   : ${
      allPassed
        ? '✓ ALL PASSED'
        : `✗ ${failed} CHECKS FAILED${assertionsPassed ? '' : ' (assertions)'}`
    }`,
  );
  console.log(`  Logs     : ${logFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(allPassed ? 0 : 1);
}

await main();
