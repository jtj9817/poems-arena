#!/usr/bin/env bun
/**
 * Manual Test Script: Phase 3 — Regression & Quality Gate
 * Track: Randomized Duel Ordering
 * Plan: conductor/tracks/randomized_duel_ordering_20260310/plan.md
 *
 * Purpose:
 *   Execute the Phase 3 regression checklist and quality gate commands for
 *   seeded duel ordering across API and web integrations.
 *
 * Run with: bun scripts/verify-phase3-randomized-duel-ordering.ts
 */

import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { DUELS_ARCHIVE_PAGE_SIZE, createDuelsRouter } from '../apps/api/src/routes/duels';
import { DUEL_ID_HEX_LENGTH, DUEL_ID_PREFIX } from '../apps/api/src/routes/seed-pivot';
import { getSessionSeed } from '../apps/web/lib/session';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase3_randomized_duel_ordering_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));
const REQUEST_BASE_URL = 'http://localhost';

const SESSION_FILE_PATH = path.join(repoRoot, 'apps', 'web', 'lib', 'session.ts');
const HOME_FILE_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'Home.tsx');
const THE_RING_FILE_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'TheRing.tsx');
const PAST_BOUTS_FILE_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'PastBouts.tsx');

const DUEL_ID_MAX_HEX = Number.parseInt('f'.repeat(DUEL_ID_HEX_LENGTH), 16);
const DETERMINISTIC_SEED = 42;
const DISTINCT_SEED_A = 1;
const DISTINCT_SEED_B = 999_999;
const STACK_TRACE_MAX_CHARS = readPositiveIntEnv('MANUAL_TEST_STACK_TRACE_MAX_CHARS', 600);
const STDOUT_TAIL_CHARS = readPositiveIntEnv('MANUAL_TEST_STDOUT_TAIL_CHARS', 1200);
const STDERR_TAIL_CHARS = readPositiveIntEnv('MANUAL_TEST_STDERR_TAIL_CHARS', 400);

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type CheckFn = () => void | Promise<void>;

type ArchiveRow = {
  id: string;
  topicMeta: { id: string | null; label: string };
  createdAt: string;
};

type ErrorPayload = { code?: string; error?: string };

type TestDb = ReturnType<typeof createDb>;

type SessionContracts = {
  seedKey: string;
  maxSessionSeed: number;
};

type SessionStorageMock = {
  store: Map<string, string>;
  setItemCallArgs: Array<[string, string]>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function tail(text: string, maxChars: number): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(-maxChars);
}

function findConstNumber(source: string, name: string): number | null {
  const pattern = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`);
  const match = source.match(pattern);
  if (!match) return null;
  const normalized = match[1]!.replaceAll('_', '');
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function findConstString(source: string, name: string): string | null {
  const pattern = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(['"])(.*?)\\1\\s*;`);
  const match = source.match(pattern);
  return match ? match[2]! : null;
}

async function loadSessionContracts(): Promise<SessionContracts> {
  const source = await Bun.file(SESSION_FILE_PATH).text();
  const seedKey = findConstString(source, 'SEED_KEY');
  const maxSessionSeed = findConstNumber(source, 'MAX_SESSION_SEED');
  if (seedKey === null || seedKey.length === 0) {
    throw new Error(`Unable to read SEED_KEY from ${SESSION_FILE_PATH}`);
  }
  if (maxSessionSeed === null) {
    throw new Error(`Unable to read MAX_SESSION_SEED from ${SESSION_FILE_PATH}`);
  }
  return { seedKey, maxSessionSeed };
}

function getAssertionFailureCount(): number {
  return TestAssertion.counts().failed;
}

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  TestLogger.startPhase(name);
  const failuresBefore = getAssertionFailureCount();
  try {
    await fn();
    const failuresAfter = getAssertionFailureCount();
    if (failuresAfter > failuresBefore) {
      TestLogger.error(`FAIL: ${name}`, { newFailures: failuresAfter - failuresBefore });
      return false;
    }
    TestLogger.endPhase(name);
    return true;
  } catch (error) {
    TestLogger.error(`FAIL: ${name}`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, STACK_TRACE_MAX_CHARS) : undefined,
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

async function createTestDb(): Promise<TestDb> {
  const db = createDb({ url: 'file::memory:' });
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
    `CREATE TABLE IF NOT EXISTS featured_duels (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      duel_id TEXT NOT NULL REFERENCES duels(id),
      featured_on TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  ];
  for (const stmt of ddl) {
    // @ts-expect-error - $client is the raw LibSQL client
    await db.$client.execute(stmt);
  }
  return db;
}

async function closeTestDb(db: TestDb): Promise<void> {
  // @ts-expect-error - internal client
  await db.$client.close();
}

async function fetchDuels(db: TestDb, query: string): Promise<Response> {
  return createDuelsRouter(db).fetch(new Request(`${REQUEST_BASE_URL}/${query}`));
}

function createSessionStorageMock(initial?: Record<string, string>): SessionStorageMock {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  const setItemCallArgs: Array<[string, string]> = [];
  return {
    store,
    setItemCallArgs,
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      setItemCallArgs.push([key, value]);
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function withSessionStorage<T>(mock: SessionStorageMock, fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const previous = g['sessionStorage'];
  g['sessionStorage'] = mock;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete g['sessionStorage'];
    } else {
      g['sessionStorage'] = previous;
    }
  }
}

async function seedSpanningDuels(
  db: TestDb,
  options: {
    prefix: string;
    count: number;
    topicId?: string;
    topicLabel?: string;
    topicName?: string;
  },
): Promise<string[]> {
  // @ts-expect-error - raw client
  const raw = db.$client;
  const topicId = options.topicId ?? `${options.prefix}_topic`;
  const topicLabel = options.topicLabel ?? 'Nature';
  const topicName = options.topicName ?? topicLabel;

  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
    args: [topicId, topicLabel],
  });

  const count = options.count;
  const step = count > 1 ? Math.floor(DUEL_ID_MAX_HEX / (count - 1)) : 0;
  const ids: string[] = [];

  for (let i = 0; i < count; i++) {
    const hex = (step * i).toString(16).padStart(DUEL_ID_HEX_LENGTH, '0');
    const duelId = `${DUEL_ID_PREFIX}${hex}`;
    const poemH = `${options.prefix}_h_${i}`;
    const poemA = `${options.prefix}_a_${i}`;
    ids.push(duelId);

    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemH, `Human ${i}`, `human ${i}`, `Author ${i}`, 'HUMAN'],
    });
    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemA, `AI ${i}`, `ai ${i}`, `Model ${i}`, 'AI'],
    });
    await raw.execute({
      sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
      args: [duelId, topicName, topicId, poemH, poemA],
    });
  }

  return ids;
}

async function seedRecentSortFixtures(db: TestDb): Promise<void> {
  // @ts-expect-error - raw client
  const raw = db.$client;

  const fixtures = [
    { topicId: 'topic-nature', topicLabel: 'Nature', topicName: 'Nature', duelId: 'duel-zeta' },
    { topicId: 'topic-love', topicLabel: 'Love', topicName: 'Love', duelId: 'duel-alpha' },
    { topicId: 'topic-nature', topicLabel: 'Nature', topicName: 'Nature', duelId: 'duel-mid' },
  ];

  await raw.execute({
    sql: 'INSERT INTO topics (id, label) VALUES (?, ?), (?, ?)',
    args: ['topic-nature', 'Nature', 'topic-love', 'Love'],
  });

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!;
    const poemH = `recent_h_${i}`;
    const poemA = `recent_a_${i}`;
    const createdAt =
      i === 0
        ? '2026-03-01T10:00:00.000Z'
        : i === 1
          ? '2026-03-03T10:00:00.000Z'
          : '2026-03-02T10:00:00.000Z';

    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemH, `H ${i}`, `h ${i}`, `Human ${i}`, 'HUMAN'],
    });
    await raw.execute({
      sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
      args: [poemA, `A ${i}`, `a ${i}`, `AI ${i}`, 'AI'],
    });
    await raw.execute({
      sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [fixture.duelId, fixture.topicName, fixture.topicId, poemH, poemA, createdAt],
    });
  }
}

function ids(rows: ArchiveRow[]): string[] {
  return rows.map((row) => row.id);
}

function isDescendingIsoTimestamps(values: string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1]! < values[i]!) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();
  TestLogger.info('=== Starting Manual Test: Phase 3 — Regression & Quality Gate ===', {
    testRunId,
    logFile,
  });

  const sessionContracts = await loadSessionContracts();
  TestLogger.info('Loaded session contracts', sessionContracts);

  let passed = 0;
  let failed = 0;
  const tally = (result: boolean) => {
    if (result) passed++;
    else failed++;
  };

  // =========================================================================
  // SECTION A: Regression checklist (runtime behavior)
  // =========================================================================

  TestLogger.info('--- Section A: Regression checklist (runtime behavior) ---');

  tally(
    await runCheck('A1: same seed returns the same first Home/The Ring duel ordering', async () => {
      const db = await createTestDb();
      try {
        await seedSpanningDuels(db, { prefix: 'A1', count: 36 });
        const [res1, res2] = await Promise.all([
          fetchDuels(db, `?page=1&seed=${DETERMINISTIC_SEED}`),
          fetchDuels(db, `?page=1&seed=${DETERMINISTIC_SEED}`),
        ]);

        TestAssertion.assertEquals(200, res1.status, 'first seeded archive request should succeed');
        TestAssertion.assertEquals(
          200,
          res2.status,
          'second seeded archive request should also succeed',
        );

        const body1 = (await res1.json()) as ArchiveRow[];
        const body2 = (await res2.json()) as ArchiveRow[];
        TestAssertion.assertTrue(
          body1.length > 0,
          'seeded page 1 should include at least one duel',
        );
        TestAssertion.assertEquals(
          body1[0]?.id ?? '',
          body2[0]?.id ?? '',
          'same seed should keep the featured first duel stable across reload-equivalent requests',
        );
        TestAssertion.assertEquals(
          JSON.stringify(ids(body1)),
          JSON.stringify(ids(body2)),
          'same seed should keep page-1 ID ordering stable',
        );
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'A2: session seed storage reuses the same seed for same-tab reload behavior',
      () => {
        const firstTabStorage = createSessionStorageMock();
        const generated = withSessionStorage(firstTabStorage, () => getSessionSeed());

        TestAssertion.assertTrue(
          Number.isSafeInteger(generated) &&
            generated >= 0 &&
            generated <= sessionContracts.maxSessionSeed,
          `generated seed ${generated} must be within [0, ${sessionContracts.maxSessionSeed}]`,
        );
        TestAssertion.assertEquals(
          String(generated),
          firstTabStorage.getItem(sessionContracts.seedKey) ?? '',
          `sessionStorage must persist generated seed under ${sessionContracts.seedKey}`,
        );

        const reloadStorage = createSessionStorageMock({
          [sessionContracts.seedKey]: String(generated),
        });
        const reloadedSeed = withSessionStorage(reloadStorage, () => getSessionSeed());
        TestAssertion.assertEquals(
          generated,
          reloadedSeed,
          'same-tab reload should reuse the persisted session seed',
        );
      },
    ),
  );

  tally(
    await runCheck('A3: distinct tab seeds produce different Home/The Ring ordering', async () => {
      const db = await createTestDb();
      try {
        await seedSpanningDuels(db, { prefix: 'A3', count: 48 });
        const [resA, resB] = await Promise.all([
          fetchDuels(db, `?page=1&seed=${DISTINCT_SEED_A}`),
          fetchDuels(db, `?page=1&seed=${DISTINCT_SEED_B}`),
        ]);
        TestAssertion.assertEquals(200, resA.status, 'seed A archive request should succeed');
        TestAssertion.assertEquals(200, resB.status, 'seed B archive request should succeed');

        const rowsA = (await resA.json()) as ArchiveRow[];
        const rowsB = (await resB.json()) as ArchiveRow[];
        TestAssertion.assertTrue(
          JSON.stringify(ids(rowsA)) !== JSON.stringify(ids(rowsB)),
          `different seeds (${DISTINCT_SEED_A} vs ${DISTINCT_SEED_B}) should alter first-page ordering`,
        );
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck(
      'A4: seeded pagination has no duplicate duel IDs across page boundaries',
      async () => {
        const db = await createTestDb();
        try {
          await seedSpanningDuels(db, { prefix: 'A4', count: DUELS_ARCHIVE_PAGE_SIZE * 3 });
          const [page1Res, page2Res] = await Promise.all([
            fetchDuels(db, `?page=1&seed=${DETERMINISTIC_SEED}`),
            fetchDuels(db, `?page=2&seed=${DETERMINISTIC_SEED}`),
          ]);
          TestAssertion.assertEquals(200, page1Res.status, 'page 1 request should succeed');
          TestAssertion.assertEquals(200, page2Res.status, 'page 2 request should succeed');

          const page1 = (await page1Res.json()) as ArchiveRow[];
          const page2 = (await page2Res.json()) as ArchiveRow[];
          TestAssertion.assertEquals(
            DUELS_ARCHIVE_PAGE_SIZE,
            page1.length,
            `page 1 should contain ${DUELS_ARCHIVE_PAGE_SIZE} duels`,
          );
          TestAssertion.assertTrue(
            page2.length > 0,
            'page 2 should contain additional duels for duplicate detection',
          );

          const overlap = page1.filter((row) => page2.some((candidate) => candidate.id === row.id));
          TestAssertion.assertEquals(
            0,
            overlap.length,
            'page 1 and page 2 should not share duel IDs in stable seeded pagination',
          );
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck(
      'A5: Past Bouts path remains chronological and topic-filtered through sort=recent',
      async () => {
        const db = await createTestDb();
        try {
          await seedRecentSortFixtures(db);
          const [allRes, filteredRes] = await Promise.all([
            fetchDuels(db, '?page=1&sort=recent'),
            fetchDuels(db, '?page=1&sort=recent&topic_id=topic-nature'),
          ]);

          TestAssertion.assertEquals(200, allRes.status, 'sort=recent request should succeed');
          TestAssertion.assertEquals(
            200,
            filteredRes.status,
            'sort=recent with topic_id request should succeed',
          );

          const allRows = (await allRes.json()) as ArchiveRow[];
          const filteredRows = (await filteredRes.json()) as ArchiveRow[];
          TestAssertion.assertTrue(
            isDescendingIsoTimestamps(allRows.map((row) => row.createdAt)),
            'sort=recent should return rows ordered by createdAt DESC',
          );
          TestAssertion.assertTrue(
            filteredRows.every((row) => row.topicMeta.id === 'topic-nature'),
            'sort=recent with topic_id should retain only the requested topic rows',
          );
          TestAssertion.assertTrue(
            isDescendingIsoTimestamps(filteredRows.map((row) => row.createdAt)),
            'topic-filtered sort=recent results should also be ordered by createdAt DESC',
          );
        } finally {
          await closeTestDb(db);
        }
      },
    ),
  );

  tally(
    await runCheck('A6: missing seed without sort=recent returns 400 MISSING_SEED', async () => {
      const db = await createTestDb();
      try {
        await seedSpanningDuels(db, { prefix: 'A6', count: 3 });
        const res = await fetchDuels(db, '?page=1');
        TestAssertion.assertEquals(400, res.status, 'missing seed should return HTTP 400');
        const body = (await res.json()) as ErrorPayload;
        TestAssertion.assertEquals(
          'MISSING_SEED',
          body.code ?? '',
          'missing seed response should include code=MISSING_SEED',
        );
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  tally(
    await runCheck('A7: invalid seed values return 400 INVALID_SEED', async () => {
      const db = await createTestDb();
      try {
        await seedSpanningDuels(db, { prefix: 'A7', count: 3 });
        const invalidSeeds = ['-1', 'abc', '1.25', '9007199254740992'];
        for (const invalidSeed of invalidSeeds) {
          const res = await fetchDuels(db, `?page=1&seed=${encodeURIComponent(invalidSeed)}`);
          TestAssertion.assertEquals(400, res.status, `seed=${invalidSeed} should return HTTP 400`);
          const body = (await res.json()) as ErrorPayload;
          TestAssertion.assertEquals(
            'INVALID_SEED',
            body.code ?? '',
            `seed=${invalidSeed} should return code=INVALID_SEED`,
          );
        }
      } finally {
        await closeTestDb(db);
      }
    }),
  );

  // =========================================================================
  // SECTION B: Frontend source contracts for regression checklist alignment
  // =========================================================================

  TestLogger.info('--- Section B: Frontend source contracts ---');

  const [homeSource, ringSource, boutsSource] = await Promise.all([
    Bun.file(HOME_FILE_PATH).text(),
    Bun.file(THE_RING_FILE_PATH).text(),
    Bun.file(PAST_BOUTS_FILE_PATH).text(),
  ]);

  tally(
    await runCheck('B1: Home.tsx loads getSessionSeed and uses it in api.getDuels()', () => {
      TestAssertion.assertTrue(
        homeSource.includes('getSessionSeed') && homeSource.includes('lib/session'),
        'Home.tsx should import getSessionSeed from ../lib/session',
      );
      TestAssertion.assertTrue(
        homeSource.includes('sessionSeedRef.current'),
        'Home.tsx should hold session seed in sessionSeedRef.current',
      );
      TestAssertion.assertTrue(
        homeSource.includes('getDuels(1, undefined, sessionSeedRef.current)'),
        'Home.tsx should request duels with the session seed',
      );
    }),
  );

  tally(
    await runCheck('B2: TheRing.tsx uses sessionSeedRef.current across queue fetches', () => {
      TestAssertion.assertTrue(
        ringSource.includes('getSessionSeed') && ringSource.includes('lib/session'),
        'TheRing.tsx should import getSessionSeed from ../lib/session',
      );
      const occurrences = ringSource.split('sessionSeedRef.current').length - 1;
      TestAssertion.assertTrue(
        occurrences >= 3,
        `TheRing.tsx should use sessionSeedRef.current in multiple getDuels paths (found ${occurrences})`,
      );
      TestAssertion.assertTrue(
        ringSource.includes(`const PAGE_SIZE = ${DUELS_ARCHIVE_PAGE_SIZE};`),
        `TheRing.tsx PAGE_SIZE should equal ${DUELS_ARCHIVE_PAGE_SIZE}`,
      );
    }),
  );

  tally(
    await runCheck(
      "B3: PastBouts.tsx requests sort='recent' and does not use getSessionSeed",
      () => {
        TestAssertion.assertTrue(
          boutsSource.includes("getDuels(1, activeTopicId ?? undefined, undefined, 'recent')"),
          "PastBouts.tsx should call getDuels(..., 'recent')",
        );
        TestAssertion.assertTrue(
          !boutsSource.includes('getSessionSeed'),
          'PastBouts.tsx should not call getSessionSeed for archive browsing',
        );
      },
    ),
  );

  // =========================================================================
  // SECTION C: Coverage and regression verification commands
  // =========================================================================

  TestLogger.info('--- Section C: Coverage and regression verification commands ---');

  const runGate = async (name: string, command: string[]) => {
    const { exitCode, stdout, stderr } = await runCommand(command, { env: { CI: 'true' } });
    TestLogger.info(`${name} output`, { command: command.join(' '), exitCode });
    if (stdout.trim()) {
      TestLogger.info(`${name} stdout tail`, { output: tail(stdout, STDOUT_TAIL_CHARS) });
    }
    if (stderr.trim()) {
      TestLogger.warning(`${name} stderr tail`, { output: tail(stderr, STDERR_TAIL_CHARS) });
    }
    TestAssertion.assertEquals(0, exitCode, `${name} should exit with code 0`);
  };

  tally(
    await runCheck('C1: Execute pnpm --filter @sanctuary/api test', async () => {
      await runGate('API test suite', ['pnpm', '--filter', '@sanctuary/api', 'test']);
    }),
  );

  tally(
    await runCheck('C2: Execute pnpm --filter @sanctuary/web test', async () => {
      await runGate('Web test suite', ['pnpm', '--filter', '@sanctuary/web', 'test']);
    }),
  );

  tally(
    await runCheck('C3: Execute pnpm run lint', async () => {
      await runGate('Lint', ['pnpm', 'run', 'lint']);
    }),
  );

  tally(
    await runCheck('C4: Execute pnpm format:check', async () => {
      await runGate('Format check', ['pnpm', 'format:check']);
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
