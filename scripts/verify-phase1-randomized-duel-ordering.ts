#!/usr/bin/env bun
/**
 * Manual Test Script: Phase 1 — API Seeded Rotation Logic
 * Track: Randomized Duel Ordering
 *
 * Purpose:
 *   Verify that GET /duels enforces the seed contract, rejects bad inputs with
 *   the correct error codes, and produces deterministic seeded rotation while
 *   preserving chronological ordering through the sort=recent bypass.
 *
 * Run with: bun scripts/verify-phase1-randomized-duel-ordering.ts
 *
 * Uses createDuelsRouter(db).fetch() with an in-memory LibSQL DB — no live
 * server required (same pattern as verify-phase3-api-updates.ts).
 */

import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { DUELS_ARCHIVE_PAGE_SIZE, createDuelsRouter } from '../apps/api/src/routes/duels';
import {
  buildSeedPivot,
  DUEL_ID_HEX_LENGTH,
  DUEL_ID_PREFIX,
} from '../apps/api/src/routes/seed-pivot';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase1_randomized_duel_ordering_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const shortId = testRunId.slice(-12).replace(/[^a-zA-Z0-9]/g, '');
const REQUEST_BASE_URL = 'http://localhost';
const DUEL_ID_MAX_HEX = Number.parseInt('f'.repeat(DUEL_ID_HEX_LENGTH), 16);
const DETERMINISTIC_SEEDS = [0, 1, 42, 99999] as const;
const DISTINCT_SEED_A = 1;
const DISTINCT_SEED_B = 999999;
const DEFAULT_TEST_SEED = 42;
const COVERAGE_TEST_SEED = 7;

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type CheckFn = () => void | Promise<void>;

function getAssertionFailureCount(): number {
  return TestAssertion.counts().failed;
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
      stack: error instanceof Error ? error.stack?.slice(0, 600) : undefined,
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
  // @ts-expect-error – internal client
  await db.$client.close();
}

/** Insert a topic, two poems, and one duel. Returns the created IDs. */
async function seedBase(db: TestDb, prefix: string) {
  // @ts-expect-error – raw client
  const raw = db.$client;
  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
    args: [`${prefix}_topic`, 'Nature'],
  });
  await raw.execute({
    sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
    args: [`${prefix}_h`, 'Human Poem', 'words words words', 'Poet A', 'HUMAN'],
  });
  await raw.execute({
    sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
    args: [`${prefix}_a`, 'AI Poem', 'words words words', 'AI Model', 'AI'],
  });
  await raw.execute({
    sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
    args: [`${prefix}_duel`, 'Nature', `${prefix}_topic`, `${prefix}_h`, `${prefix}_a`],
  });
  return { topicId: `${prefix}_topic`, duelId: `${prefix}_duel` };
}

/**
 * Insert N duels whose IDs span the full duel-<hex> range evenly.
 * Returns the list of inserted duel IDs.
 */
async function seedSpanningDuels(db: TestDb, prefix: string, count: number): Promise<string[]> {
  // @ts-expect-error – raw client
  const raw = db.$client;
  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
    args: [`${prefix}_topic`, 'Nature'],
  });

  const step = Math.floor(DUEL_ID_MAX_HEX / (count - 1));
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const hex = (step * i).toString(16).padStart(DUEL_ID_HEX_LENGTH, '0');
    const duelId = `${DUEL_ID_PREFIX}${hex}`;
    ids.push(duelId);
    const poemH = `${prefix}_h${i}`;
    const poemA = `${prefix}_a${i}`;
    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemH, `H${i}`, 'x', `A${i}`, 'HUMAN'],
    });
    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemA, `AI${i}`, 'y', `B${i}`, 'AI'],
    });
    await raw.execute({
      sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
      args: [duelId, 'Nature', `${prefix}_topic`, poemH, poemA],
    });
  }

  return ids;
}

/** Send a request to a fresh duels router backed by the given DB. */
async function fetch(db: TestDb, path: string): Promise<Response> {
  return createDuelsRouter(db).fetch(new Request(`${REQUEST_BASE_URL}${path}`));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();
  TestLogger.info('=== Starting Manual Test: Phase 1 — Randomized Duel Ordering ===', {
    testRunId,
    logFile,
  });

  let passed = 0;
  let failed = 0;
  const tally = (result: boolean) => {
    if (result) passed++;
    else failed++;
  };

  // =========================================================================
  // SECTION A: buildSeedPivot utility
  // =========================================================================

  TestLogger.info('--- Section A: buildSeedPivot utility ---');

  tally(
    await runCheck('A1: output matches duel-<12 hex chars> format', () => {
      const pivot = buildSeedPivot(DEFAULT_TEST_SEED);
      TestAssertion.assertTrue(
        new RegExp(`^${DUEL_ID_PREFIX}[0-9a-f]{${DUEL_ID_HEX_LENGTH}}$`).test(pivot),
        `"${pivot}" must match ${DUEL_ID_PREFIX}<${DUEL_ID_HEX_LENGTH} hex>`,
      );
      TestLogger.info('A1 pivot', { pivot });
    }),
  );

  tally(
    await runCheck('A2: same seed always returns the same pivot (determinism)', () => {
      for (const seed of DETERMINISTIC_SEEDS) {
        const a = buildSeedPivot(seed);
        const b = buildSeedPivot(seed);
        TestAssertion.assertEquals(a, b, `seed ${seed} must be deterministic`);
      }
      TestLogger.info('A2 determinism verified', { seeds: DETERMINISTIC_SEEDS });
    }),
  );

  tally(
    await runCheck('A3: different seeds produce different pivots', () => {
      const p1 = buildSeedPivot(DISTINCT_SEED_A);
      const p2 = buildSeedPivot(DISTINCT_SEED_B);
      TestAssertion.assertTrue(
        p1 !== p2,
        `seeds ${DISTINCT_SEED_A} and ${DISTINCT_SEED_B} must produce distinct pivots`,
      );
      TestLogger.info('A3 pivots', { seedA: p1, seedB: p2 });
    }),
  );

  tally(
    await runCheck('A4: throws RangeError for unsafe integer seed', () => {
      let threw = false;
      try {
        buildSeedPivot(Number.MAX_SAFE_INTEGER + 1);
      } catch (e) {
        threw = e instanceof RangeError;
      }
      TestAssertion.assertTrue(threw, 'unsafe integer must throw RangeError');
    }),
  );

  tally(
    await runCheck('A5: throws RangeError for negative seed', () => {
      let threw = false;
      try {
        buildSeedPivot(-1);
      } catch (e) {
        threw = e instanceof RangeError;
      }
      TestAssertion.assertTrue(threw, 'negative seed must throw RangeError');
    }),
  );

  // =========================================================================
  // SECTION B: Seed validation — MISSING_SEED
  // =========================================================================

  TestLogger.info('--- Section B: MISSING_SEED validation ---');

  tally(
    await runCheck('B1: GET / (no seed, no sort) → 400 MISSING_SEED', async () => {
      const db = await createTestDb();
      try {
        await seedBase(db, `b1_${shortId}`);
        const res = await fetch(db, '/');
        TestAssertion.assertEquals(400, res.status, 'status must be 400');
        const body = (await res.json()) as { code: string; error: string };
        TestAssertion.assertEquals('MISSING_SEED', body.code, 'code must be MISSING_SEED');
        TestAssertion.assertTrue(typeof body.error === 'string', 'error must be a string');
        TestLogger.info('B1 body', body);
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('B2: GET /?topic_id=x (no seed, no sort) → 400 MISSING_SEED', async () => {
      const db = await createTestDb();
      try {
        const ids = await seedBase(db, `b2_${shortId}`);
        const res = await fetch(db, `/?topic_id=${ids.topicId}`);
        TestAssertion.assertEquals(400, res.status, 'status must be 400');
        const body = (await res.json()) as { code: string };
        TestAssertion.assertEquals('MISSING_SEED', body.code, 'code must be MISSING_SEED');
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('B3: error envelope has exactly {error, code} keys', async () => {
      const db = await createTestDb();
      try {
        const res = await fetch(db, '/');
        const body = (await res.json()) as Record<string, unknown>;
        const keys = Object.keys(body).sort().join(',');
        TestAssertion.assertEquals('code,error', keys, 'envelope must only have {error,code}');
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION C: Seed validation — INVALID_SEED
  // =========================================================================

  TestLogger.info('--- Section C: INVALID_SEED validation ---');

  const invalidSeeds: Array<[string, string]> = [
    ['C1: seed=-1 (negative)', '/?seed=-1'],
    ['C2: seed=1.5 (decimal)', '/?seed=1.5'],
    ['C3: seed=abc (non-numeric)', '/?seed=abc'],
    ['C4: seed=9007199254740992 (unsafe integer)', '/?seed=9007199254740992'],
  ];

  for (const [label, path] of invalidSeeds) {
    tally(
      await runCheck(`${label} → 400 INVALID_SEED`, async () => {
        const db = await createTestDb();
        try {
          const res = await fetch(db, path);
          TestAssertion.assertEquals(400, res.status, `status must be 400 for ${path}`);
          const body = (await res.json()) as { code: string; error: string };
          TestAssertion.assertEquals('INVALID_SEED', body.code, 'code must be INVALID_SEED');
          TestAssertion.assertTrue(typeof body.error === 'string', 'error must be a string');
          TestLogger.info(`${label} body`, body);
        } finally {
          await closeTestDb(db);
        }
      }),
    );
  }

  // =========================================================================
  // SECTION D: Valid seed — 200 response and response shape
  // =========================================================================

  TestLogger.info('--- Section D: Valid seed → 200 response ---');

  tally(
    await runCheck('D1: GET /?seed=42 → 200 with array body', async () => {
      const db = await createTestDb();
      try {
        await seedBase(db, `d1_${shortId}`);
        const res = await fetch(db, `/?seed=${DEFAULT_TEST_SEED}`);
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as unknown[];
        TestAssertion.assertTrue(Array.isArray(body), 'body must be an array');
        TestLogger.info('D1 response', { count: body.length });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('D2: GET /?seed=0 → 200 (zero is valid)', async () => {
      const db = await createTestDb();
      try {
        await seedBase(db, `d2_${shortId}`);
        const res = await fetch(db, '/?seed=0');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'D3: page validation still fires before seed check (page=0&seed=42 → INVALID_PAGE)',
      async () => {
        const db = await createTestDb();
        try {
          const res = await fetch(db, '/?page=0&seed=42');
          TestAssertion.assertEquals(400, res.status, 'status must be 400');
          const body = (await res.json()) as { code: string };
          TestAssertion.assertEquals('INVALID_PAGE', body.code, 'page is validated before seed');
          TestLogger.info('D3 body', body);
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  // =========================================================================
  // SECTION E: Seeded ordering — determinism and rotation
  // =========================================================================

  TestLogger.info('--- Section E: Seeded ordering ---');

  tally(
    await runCheck(
      'E1: same seed returns identical first-page ordering on repeated calls',
      async () => {
        const db = await createTestDb();
        try {
          await seedSpanningDuels(db, `e1_${shortId}`, 5);
          const res1 = await fetch(db, `/?seed=${DEFAULT_TEST_SEED}`);
          const res2 = await fetch(db, `/?seed=${DEFAULT_TEST_SEED}`);
          TestAssertion.assertEquals(200, res1.status, 'first call must be 200');
          TestAssertion.assertEquals(200, res2.status, 'second call must be 200');
          const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
          const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
          TestAssertion.assertEquals(
            ids1.join(','),
            ids2.join(','),
            'ordering must be identical for same seed',
          );
          TestLogger.info(`E1 ids (seed=${DEFAULT_TEST_SEED})`, { ids: ids1 });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'E2: different seeds produce different first-page orderings (16-duel corpus)',
      async () => {
        const db = await createTestDb();
        try {
          await seedSpanningDuels(db, `e2_${shortId}`, 16);
          const res1 = await fetch(db, `/?seed=${DISTINCT_SEED_A}`);
          const res2 = await fetch(db, `/?seed=${DISTINCT_SEED_B}`);
          TestAssertion.assertEquals(200, res1.status, `seed=${DISTINCT_SEED_A} must be 200`);
          TestAssertion.assertEquals(200, res2.status, `seed=${DISTINCT_SEED_B} must be 200`);
          const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
          const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
          TestAssertion.assertTrue(
            JSON.stringify(ids1) !== JSON.stringify(ids2),
            'different seeds must produce different orderings',
          );
          TestLogger.info(`E2 seed=${DISTINCT_SEED_A} first 3 ids`, { ids: ids1.slice(0, 3) });
          TestLogger.info(`E2 seed=${DISTINCT_SEED_B} first 3 ids`, { ids: ids2.slice(0, 3) });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'E3: seeded pagination has no duplicate IDs across pages (14-duel corpus)',
      async () => {
        const db = await createTestDb();
        try {
          await seedSpanningDuels(db, `e3_${shortId}`, 14);
          const res1 = await fetch(db, `/?seed=${DEFAULT_TEST_SEED}&page=1`);
          const res2 = await fetch(db, `/?seed=${DEFAULT_TEST_SEED}&page=2`);
          TestAssertion.assertEquals(200, res1.status, 'page 1 must be 200');
          TestAssertion.assertEquals(200, res2.status, 'page 2 must be 200');
          const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
          const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
          TestAssertion.assertEquals(
            DUELS_ARCHIVE_PAGE_SIZE,
            ids1.length,
            `page 1 must have ${DUELS_ARCHIVE_PAGE_SIZE} duels`,
          );
          TestAssertion.assertTrue(ids2.length > 0, 'page 2 must have at least 1 duel');
          const overlap = ids1.filter((id) => ids2.includes(id));
          TestAssertion.assertEquals(0, overlap.length, 'no duel ID should appear on both pages');
          TestLogger.info('E3 pagination', {
            page1Count: ids1.length,
            page2Count: ids2.length,
            overlap: overlap.length,
          });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'E4: seeded result contains all duel IDs across pages (no missing, no dupes)',
      async () => {
        const db = await createTestDb();
        try {
          const allIds = await seedSpanningDuels(db, `e4_${shortId}`, 14);
          const res1 = await fetch(db, `/?seed=${COVERAGE_TEST_SEED}&page=1`);
          const res2 = await fetch(db, `/?seed=${COVERAGE_TEST_SEED}&page=2`);
          const ids1 = ((await res1.json()) as Array<{ id: string }>).map((d) => d.id);
          const ids2 = ((await res2.json()) as Array<{ id: string }>).map((d) => d.id);
          const combined = [...ids1, ...ids2];
          TestAssertion.assertEquals(14, combined.length, 'combined pages must cover all 14 duels');
          const unique = new Set(combined);
          TestAssertion.assertEquals(14, unique.size, 'all 14 combined IDs must be unique');
          // Every seeded ID must appear in one of the pages
          const missing = allIds.filter((id) => !unique.has(id));
          TestAssertion.assertEquals(
            0,
            missing.length,
            'no seeded duel should be missing across pages',
          );
          TestLogger.info('E4 full coverage', {
            page1: ids1.length,
            page2: ids2.length,
            unique: unique.size,
          });
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  // =========================================================================
  // SECTION F: sort=recent bypass
  // =========================================================================

  TestLogger.info('--- Section F: sort=recent bypass ---');

  tally(
    await runCheck('F1: GET /?sort=recent → 200 without seed', async () => {
      const db = await createTestDb();
      try {
        await seedBase(db, `f1_${shortId}`);
        const res = await fetch(db, '/?sort=recent');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as unknown[];
        TestAssertion.assertTrue(Array.isArray(body), 'body must be an array');
        TestLogger.info('F1 sort=recent', { count: body.length });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('F2: sort=recent supports topic_id filtering', async () => {
      const db = await createTestDb();
      try {
        // @ts-expect-error – raw client
        const raw = db.$client;
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: ['t-nature', 'Nature'],
        });
        await raw.execute({
          sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
          args: ['t-love', 'Love'],
        });
        for (const [poemH, poemA, duelId, topicId] of [
          [`f2h1_${shortId}`, `f2a1_${shortId}`, `f2d1_${shortId}`, 't-nature'],
          [`f2h2_${shortId}`, `f2a2_${shortId}`, `f2d2_${shortId}`, 't-love'],
        ]) {
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [poemH, 'H', 'x', 'A', 'HUMAN'],
          });
          await raw.execute({
            sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
            args: [poemA, 'AI', 'y', 'B', 'AI'],
          });
          await raw.execute({
            sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
            args: [duelId, topicId === 't-nature' ? 'Nature' : 'Love', topicId, poemH, poemA],
          });
        }
        const res = await fetch(db, '/?sort=recent&topic_id=t-nature');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as Array<{ id: string; topicMeta: { id: string } }>;
        TestAssertion.assertEquals(1, body.length, 'must return exactly 1 Nature duel');
        TestAssertion.assertEquals(`f2d1_${shortId}`, body[0]!.id, 'must return the Nature duel');
        TestAssertion.assertEquals(
          't-nature',
          body[0]!.topicMeta.id,
          'topicMeta.id must be t-nature',
        );
        TestLogger.info('F2 filtered result', { id: body[0]!.id, topicMeta: body[0]!.topicMeta });
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('F3: sort=recent returns all duels when no topic_id is given', async () => {
      const db = await createTestDb();
      try {
        await seedBase(db, `f3a_${shortId}`);
        await seedBase(db, `f3b_${shortId}`);
        const res = await fetch(db, '/?sort=recent');
        TestAssertion.assertEquals(200, res.status, 'status must be 200');
        const body = (await res.json()) as unknown[];
        TestAssertion.assertEquals(2, body.length, 'must return both duels');
      } finally {
        await closeTestDb(db);
      }
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
      TestLogger.info('G1 test output', { exitCode, stdout: stdout.trim().slice(-1000) });
      if (stderr.trim()) TestLogger.warning('G1 stderr', { output: stderr.trim().slice(-400) });
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

  TestLogger.info('=== Manual Test Completed ===', { passed, failed, total });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Test ID  : ${testRunId}`);
  console.log(`  Checks   : ${passed}/${total} passed`);
  console.log(`  Result   : ${allPassed ? '✓ ALL PASSED' : `✗ ${failed} CHECK(S) FAILED`}`);
  console.log(`  Logs     : ${logFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(allPassed ? 0 : 1);
}

await main();
