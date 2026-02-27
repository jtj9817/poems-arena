#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 0: Backend Prerequisites
 * Track: Phase 6 — Frontend Integration
 * Generated: 2026-02-26
 * Purpose: Verify GET /api/v1/topics, topic_id filtering on GET /api/v1/duels,
 *          topicMeta shape on /duels list, sourceInfo shape on /duels/:id/stats,
 *          and shared type exports (TopicMeta, SourceInfo) from @sanctuary/shared.
 *
 * Run with: bun scripts/verify-phase0-frontend-backend-prereqs.ts
 *
 * Uses createDb from packages/db + direct router invocation via .fetch() so no
 * live server is required (same pattern as verify-phase3-api-updates.ts).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { createDuelsRouter } from '../apps/api/src/routes/duels';
import { createTopicsRouter } from '../apps/api/src/routes/topics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase0_backend_prereqs_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

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

async function createTestDb(): Promise<TestDb> {
  const db = createDb({ url: 'file::memory:' });
  for (const stmt of SCHEMA_DDL) {
    // @ts-expect-error – $client is the raw LibSQL client
    await db.$client.execute(stmt);
  }
  return db;
}

async function closeTestDb(db: TestDb): Promise<void> {
  // @ts-expect-error – accessing internal client for cleanup
  await db.$client.close();
}

/** Seed one topic, two poems, and one duel for a given prefix. */
async function seedBase(db: TestDb, prefix: string) {
  // @ts-expect-error – raw client
  const raw = db.$client;
  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
    args: [`${prefix}_topic`, 'Nature'],
  });
  await raw.execute({
    sql: 'INSERT INTO poems (id, title, content, author, type, year, source, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [
      `${prefix}_h`,
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
      `${prefix}_a`,
      'Generated Verse',
      'A machine contemplates the autumn leaves',
      'Claude 3 Opus',
      'AI',
    ],
  });
  await raw.execute({
    sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
    args: [`${prefix}_duel`, 'Nature', `${prefix}_topic`, `${prefix}_h`, `${prefix}_a`],
  });
  return {
    topicId: `${prefix}_topic`,
    humanId: `${prefix}_h`,
    aiId: `${prefix}_a`,
    duelId: `${prefix}_duel`,
  };
}

async function topicsRouterFetch(db: TestDb, urlPath: string): Promise<Response> {
  const router = createTopicsRouter(db);
  return router.fetch(new Request(`http://localhost${urlPath}`));
}

async function duelsRouterFetch(db: TestDb, urlPath: string): Promise<Response> {
  const router = createDuelsRouter(db);
  return router.fetch(new Request(`http://localhost${urlPath}`));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 0 — Backend Prerequisites ===', {
    testRunId,
    logFile,
  });

  let passed = 0;
  let failed = 0;

  function tally(result: boolean): void {
    if (result) passed++;
    else failed++;
  }

  // =========================================================================
  // SECTION A: File-system checks
  // =========================================================================

  TestLogger.info('--- Section A: Required files exist ---');

  tally(
    await runCheck('A1: apps/api/src/routes/topics.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/api/src/routes/topics.ts')),
        'topics.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A2: apps/api/src/routes/topics.test.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/api/src/routes/topics.test.ts')),
        'topics.test.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A3: packages/shared/src/index.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'packages/shared/src/index.ts')),
        'shared/index.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A4: createTopicsRouter is an exported function', () => {
      TestAssertion.assertTrue(
        typeof createTopicsRouter === 'function',
        'createTopicsRouter must be a function',
      );
    }),
  );

  // =========================================================================
  // SECTION B: GET /topics — new endpoint
  // =========================================================================

  TestLogger.info('--- Section B: GET /topics ---');

  tally(
    await runCheck('B1: returns empty array when topics table is empty', async () => {
      const db = await createTestDb();
      try {
        const res = await topicsRouterFetch(db, '/');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = await res.json();
        TestAssertion.assertTrue(Array.isArray(body), 'response must be an array');
        TestAssertion.assertEquals(
          0,
          (body as unknown[]).length,
          'empty DB must return empty array',
        );
        TestLogger.info('B1 empty topics confirmed', { body });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('B2: returns all topics with id and label fields', async () => {
      const db = await createTestDb();
      try {
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`b2_nature_${shortId}`, 'Nature'],
        });
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`b2_love_${shortId}`, 'Love'],
        });

        const res = await topicsRouterFetch(db, '/');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as Array<{ id: string; label: string }>;
        TestAssertion.assertEquals(2, body.length, 'must return 2 topics');

        const ids = body.map((t) => t.id);
        TestAssertion.assertTrue(
          ids.includes(`b2_nature_${shortId}`),
          'Nature topic id must be present',
        );
        TestAssertion.assertTrue(
          ids.includes(`b2_love_${shortId}`),
          'Love topic id must be present',
        );

        // Verify shape: every item has exactly id and label
        for (const item of body) {
          TestAssertion.assertTrue(typeof item.id === 'string', 'topic.id must be a string');
          TestAssertion.assertTrue(typeof item.label === 'string', 'topic.label must be a string');
        }
        TestLogger.info('B2 topics', body);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('B3: topics are returned ordered by label ascending', async () => {
      const db = await createTestDb();
      try {
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`b3_z_${shortId}`, 'Zen'],
        });
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`b3_a_${shortId}`, 'Autumn'],
        });
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`b3_m_${shortId}`, 'Memory'],
        });

        const res = await topicsRouterFetch(db, '/');
        const body = (await res.json()) as Array<{ label: string }>;
        const labels = body.map((t) => t.label);
        TestAssertion.assertEquals('Autumn', labels[0], 'first label must be Autumn');
        TestAssertion.assertEquals('Memory', labels[1], 'second label must be Memory');
        TestAssertion.assertEquals('Zen', labels[2], 'third label must be Zen');
        TestLogger.info('B3 order', { labels });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION C: GET /duels — topicMeta shape
  // =========================================================================

  TestLogger.info('--- Section C: GET /duels — topicMeta shape ---');

  tally(
    await runCheck('C1: GET /duels includes topicMeta with id and label', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `c1_${shortId}`);
        const res = await duelsRouterFetch(db, '/');
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
          'topicMeta.id must match topic id',
        );
        TestAssertion.assertEquals(
          'Nature',
          duel!.topicMeta.label,
          'topicMeta.label must be Nature',
        );
        TestLogger.info('C1 topicMeta', duel!.topicMeta);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'C2: topicMeta falls back to { id: null, label: duel.topic } when topic_id is null',
      async () => {
        const db = await createTestDb();
        try {
          // @ts-expect-error – raw client
          const raw = db.$client;
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`c2h_${shortId}`, 'H', 'x', 'A', 'HUMAN'],
          });
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [`c2a_${shortId}`, 'A', 'y', 'B', 'AI'],
          });
          await raw.execute({
            sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, NULL, ?, ?)',
            args: [`c2_duel_${shortId}`, 'Orphan Theme', `c2h_${shortId}`, `c2a_${shortId}`],
          });

          const res = await duelsRouterFetch(db, '/');
          const body = (await res.json()) as Array<{
            id: string;
            topicMeta: { id: string | null; label: string };
          }>;
          const duel = body.find((d) => d.id === `c2_duel_${shortId}`);
          TestAssertion.assertNotNull(duel, 'orphan duel must appear');
          TestAssertion.assertEquals(
            null,
            duel!.topicMeta.id,
            'topicMeta.id must be null for orphan',
          );
          TestAssertion.assertEquals(
            'Orphan Theme',
            duel!.topicMeta.label,
            'topicMeta.label must fall back to duel.topic',
          );
          TestLogger.info('C2 orphan topicMeta', duel!.topicMeta);
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  // =========================================================================
  // SECTION D: GET /duels?topic_id=... — new topic filtering
  // =========================================================================

  TestLogger.info('--- Section D: GET /duels?topic_id — filtering ---');

  tally(
    await runCheck('D1: topic_id filter returns only matching duels', async () => {
      const db = await createTestDb();
      try {
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`d1_nat_${shortId}`, 'Nature'],
        });
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`d1_lov_${shortId}`, 'Love'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d1_h1_${shortId}`, 'H1', 'c', 'A', 'HUMAN'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d1_a1_${shortId}`, 'A1', 'c', 'B', 'AI'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d1_h2_${shortId}`, 'H2', 'c', 'C', 'HUMAN'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d1_a2_${shortId}`, 'A2', 'c', 'D', 'AI'],
        });
        await raw.execute({
          sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            `d1_nat_duel_${shortId}`,
            'Nature',
            `d1_nat_${shortId}`,
            `d1_h1_${shortId}`,
            `d1_a1_${shortId}`,
          ],
        });
        await raw.execute({
          sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            `d1_lov_duel_${shortId}`,
            'Love',
            `d1_lov_${shortId}`,
            `d1_h2_${shortId}`,
            `d1_a2_${shortId}`,
          ],
        });

        // Filter to Nature only
        const natRes = await duelsRouterFetch(db, `/?topic_id=d1_nat_${shortId}`);
        TestAssertion.assertEquals(200, natRes.status, 'status must be 200');
        const natBody = (await natRes.json()) as Array<{ id: string }>;
        TestAssertion.assertEquals(1, natBody.length, 'must return exactly 1 Nature duel');
        TestAssertion.assertEquals(
          `d1_nat_duel_${shortId}`,
          natBody[0]!.id,
          'returned duel must be the Nature duel',
        );
        TestLogger.info('D1 Nature filter', { duelId: natBody[0]!.id });

        // Filter to Love only
        const lovRes = await duelsRouterFetch(db, `/?topic_id=d1_lov_${shortId}`);
        TestAssertion.assertEquals(200, lovRes.status, 'status must be 200');
        const lovBody = (await lovRes.json()) as Array<{ id: string }>;
        TestAssertion.assertEquals(1, lovBody.length, 'must return exactly 1 Love duel');
        TestAssertion.assertEquals(
          `d1_lov_duel_${shortId}`,
          lovBody[0]!.id,
          'returned duel must be the Love duel',
        );
        TestLogger.info('D1 Love filter', { duelId: lovBody[0]!.id });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('D2: topic_id filter returns empty array for unknown topic', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `d2_${shortId}`);
        const res = await duelsRouterFetch(db, '/?topic_id=nonexistent-topic');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as unknown[];
        TestAssertion.assertEquals(0, body.length, 'unknown topic must return empty array');
        TestLogger.info('D2 empty filter confirmed', { duelId: ids.duelId });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('D3: absent topic_id returns all duels unfiltered', async () => {
      const db = await createTestDb();
      try {
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: [`d3_t_${shortId}`, 'T'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d3_h1_${shortId}`, 'H1', 'c', 'A', 'HUMAN'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d3_a1_${shortId}`, 'A1', 'c', 'B', 'AI'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d3_h2_${shortId}`, 'H2', 'c', 'C', 'HUMAN'],
        });
        await raw.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [`d3_a2_${shortId}`, 'A2', 'c', 'D', 'AI'],
        });
        await raw.execute({
          sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            `d3_d1_${shortId}`,
            'T',
            `d3_t_${shortId}`,
            `d3_h1_${shortId}`,
            `d3_a1_${shortId}`,
          ],
        });
        await raw.execute({
          sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
          args: [
            `d3_d2_${shortId}`,
            'T',
            `d3_t_${shortId}`,
            `d3_h2_${shortId}`,
            `d3_a2_${shortId}`,
          ],
        });

        const res = await duelsRouterFetch(db, '/');
        const body = (await res.json()) as Array<{ id: string }>;
        TestAssertion.assertEquals(2, body.length, 'no topic_id must return all 2 duels');
        TestLogger.info('D3 unfiltered count', { count: body.length });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('D4: filtered result includes topicMeta', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `d4_${shortId}`);
        const res = await duelsRouterFetch(db, `/?topic_id=${ids.topicId}`);
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as Array<{
          id: string;
          topicMeta: { id: string; label: string };
        }>;
        TestAssertion.assertEquals(1, body.length, 'must return exactly 1 duel');
        TestAssertion.assertEquals(ids.topicId, body[0]!.topicMeta.id, 'topicMeta.id must be set');
        TestAssertion.assertEquals(
          'Nature',
          body[0]!.topicMeta.label,
          'topicMeta.label must be Nature',
        );
        TestLogger.info('D4 filtered topicMeta', body[0]!.topicMeta);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION E: GET /duels/:id/stats — sourceInfo shape
  // =========================================================================

  TestLogger.info('--- Section E: GET /duels/:id/stats — sourceInfo ---');

  tally(
    await runCheck(
      'E1: poemA and poemB both include sourceInfo with primary and provenances',
      async () => {
        const db = await createTestDb();
        try {
          const ids = await seedBase(db, `e1_${shortId}`);
          // @ts-expect-error – raw client
          await db.$client.execute({
            sql: 'INSERT INTO scrape_sources (id, poem_id, source, source_url, scraped_at, is_public_domain) VALUES (?, ?, ?, ?, ?, ?)',
            args: [
              `ss_e1_${shortId}`,
              ids.humanId,
              'Poetry Foundation',
              'https://poetryfoundation.org/poem/road',
              '2024-03-01T00:00:00.000Z',
              1,
            ],
          });

          const res = await duelsRouterFetch(db, `/${ids.duelId}/stats`);
          TestAssertion.assertEquals(200, res.status, 'status must be 200');
          const body = (await res.json()) as {
            duel: {
              poemA: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
              poemB: { sourceInfo: { primary: Record<string, unknown>; provenances: unknown[] } };
            };
          };

          // poemA (human) — has source from poems row + 1 scrape provenance
          TestAssertion.assertNotNull(
            body.duel.poemA.sourceInfo,
            'poemA.sourceInfo must be present',
          );
          TestAssertion.assertEquals(
            'Poetry Foundation',
            body.duel.poemA.sourceInfo.primary.source as string,
            'poemA primary.source must match',
          );
          TestAssertion.assertEquals(
            1,
            body.duel.poemA.sourceInfo.provenances.length,
            'poemA must have 1 provenance',
          );

          // poemB (AI) — no scrape sources
          TestAssertion.assertNotNull(
            body.duel.poemB.sourceInfo,
            'poemB.sourceInfo must be present',
          );
          TestAssertion.assertEquals(
            null,
            body.duel.poemB.sourceInfo.primary.source,
            'AI poemB primary.source must be null',
          );
          TestAssertion.assertEquals(
            0,
            body.duel.poemB.sourceInfo.provenances.length,
            'AI poemB must have 0 provenances',
          );

          TestLogger.info('E1 poemA sourceInfo', body.duel.poemA.sourceInfo);
          TestLogger.info('E1 poemB sourceInfo', body.duel.poemB.sourceInfo);
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck('E2: provenances are sorted by scrapedAt descending', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `e2_${shortId}`);
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO scrape_sources (id, poem_id, source, source_url, scraped_at, is_public_domain) VALUES (?, ?, ?, ?, ?, ?)',
          args: [
            `ss_e2_old_${shortId}`,
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
            `ss_e2_new_${shortId}`,
            ids.humanId,
            'New Source',
            'https://new.example.com',
            '2024-06-01T00:00:00.000Z',
            1,
          ],
        });

        const res = await duelsRouterFetch(db, `/${ids.duelId}/stats`);
        const body = (await res.json()) as {
          duel: { poemA: { sourceInfo: { provenances: Array<{ scrapedAt: string }> } } };
        };
        const p = body.duel.poemA.sourceInfo.provenances;
        TestAssertion.assertEquals(2, p.length, 'must have 2 provenances');
        TestAssertion.assertEquals(
          '2024-06-01T00:00:00.000Z',
          p[0]!.scrapedAt,
          'newest must come first',
        );
        TestAssertion.assertEquals(
          '2023-01-01T00:00:00.000Z',
          p[1]!.scrapedAt,
          'oldest must come second',
        );
        TestLogger.info('E2 provenance order', { first: p[0]!.scrapedAt, second: p[1]!.scrapedAt });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('E3: stats response includes topicMeta alongside sourceInfo', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `e3_${shortId}`);
        const res = await duelsRouterFetch(db, `/${ids.duelId}/stats`);
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as {
          humanWinRate: number;
          avgReadingTime: string;
          duel: { topicMeta: { id: string | null; label: string } };
        };
        TestAssertion.assertEquals(
          ids.topicId,
          body.duel.topicMeta.id,
          'stats topicMeta.id must match',
        );
        TestAssertion.assertEquals(
          'Nature',
          body.duel.topicMeta.label,
          'stats topicMeta.label must be Nature',
        );
        TestAssertion.assertTrue(
          typeof body.humanWinRate === 'number',
          'humanWinRate must be a number',
        );
        TestAssertion.assertTrue(
          typeof body.avgReadingTime === 'string',
          'avgReadingTime must be a string',
        );
        TestLogger.info('E3 stats summary', {
          humanWinRate: body.humanWinRate,
          avgReadingTime: body.avgReadingTime,
        });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION F: Shared types — TopicMeta and SourceInfo exported
  // =========================================================================

  TestLogger.info('--- Section F: @sanctuary/shared type exports ---');

  tally(
    await runCheck('F1: TopicMeta is exported from @sanctuary/shared', async () => {
      // Import the module and check that the expected exports don't throw at
      // import time (type-only exports are erased but structural check still applies).
      const shared = await import('../packages/shared/src/index');
      // AuthorType and ViewState are runtime values — their presence confirms the module loads
      TestAssertion.assertTrue(
        typeof shared.AuthorType === 'object',
        'AuthorType enum must be exported from @sanctuary/shared',
      );
      TestAssertion.assertTrue(
        typeof shared.ViewState === 'object',
        'ViewState enum must be exported from @sanctuary/shared',
      );
      // The source file must contain the TopicMeta and SourceInfo identifiers
      const sourceFile = Bun.file(path.join(repoRoot, 'packages/shared/src/index.ts'));
      const source = await sourceFile.text();
      TestAssertion.assertTrue(
        source.includes('TopicMeta'),
        'shared/index.ts must define TopicMeta',
      );
      TestAssertion.assertTrue(
        source.includes('SourceInfo'),
        'shared/index.ts must define SourceInfo',
      );
      TestAssertion.assertTrue(
        source.includes('SourceProvenance'),
        'shared/index.ts must define SourceProvenance',
      );
      TestAssertion.assertTrue(
        source.includes('sourceInfo?:'),
        'Poem interface must include optional sourceInfo field',
      );
      TestLogger.info('F1 shared type exports confirmed');
    }),
  );

  // =========================================================================
  // SECTION G: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section G: Automated test suite ---');

  tally(
    await runCheck('G1: pnpm --filter @sanctuary/api test exits 0', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/api', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('G1 test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('G1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/api test suite must exit 0');
    }),
  );

  tally(
    await runCheck('G2: pnpm --filter @sanctuary/shared build exits 0 (type check)', async () => {
      const { exitCode, stdout, stderr } = await runCommand([
        'pnpm',
        '--filter',
        '@sanctuary/shared',
        'build',
      ]);
      TestLogger.info('G2 build output', { exitCode, stdout: stdout.trim().slice(-400) });
      if (stderr.trim()) TestLogger.info('G2 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/shared tsc --noEmit must pass');
    }),
  );

  // =========================================================================
  // Summary
  // =========================================================================

  const assertionsPassed = TestAssertion.summary();
  const checksPassed = failed === 0;
  const allPassed = assertionsPassed && checksPassed;
  const total = passed + failed;

  TestLogger.info('=== Manual Test Completed ===', { passed, failed, total });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(allPassed ? 0 : 1);
}

await main();
