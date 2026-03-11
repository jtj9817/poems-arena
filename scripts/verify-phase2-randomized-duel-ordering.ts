#!/usr/bin/env bun
/**
 * Manual Test Script: Phase 2 — Frontend Integration & Pagination Fix
 * Track: Randomized Duel Ordering
 * Plan: conductor/tracks/randomized_duel_ordering_20260310/plan.md
 *
 * Purpose:
 *   Verify that session-scoped seeded ordering is applied to Home and TheRing,
 *   Past Bouts stays chronological via sort=recent, and the queue page-size
 *   constant matches the API contract.
 *
 * Run with: bun scripts/verify-phase2-randomized-duel-ordering.ts
 *
 * Verification approach:
 *   Section A — Exercise getSessionSeed() with a mocked sessionStorage.
 *   Section B — Exercise api.getDuels() URL construction with a mocked fetch.
 *   Section C — Static source analysis of Home.tsx, TheRing.tsx, PastBouts.tsx.
 *   Section D — Execute the automated web test suite.
 */

import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { getSessionSeed } from '../apps/web/lib/session';
import { api } from '../apps/web/lib/api';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase2_randomized_duel_ordering_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const MAX_SESSION_SEED = 2_147_483_647;
const SEED_KEY = 'duel-seed';
const EXPECTED_PAGE_SIZE = 12;

const HOME_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'Home.tsx');
const THE_RING_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'TheRing.tsx');
const PAST_BOUTS_PATH = path.join(repoRoot, 'apps', 'web', 'pages', 'PastBouts.tsx');

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type CheckFn = () => void | Promise<void>;

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
// sessionStorage mock helpers
// ---------------------------------------------------------------------------

type SessionStorageMock = {
  store: Map<string, string>;
  setItemCallArgs: Array<[string, string]>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

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
  const prev = g['sessionStorage'];
  g['sessionStorage'] = mock;
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete g['sessionStorage'];
    } else {
      g['sessionStorage'] = prev;
    }
  }
}

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

type CapturedRequest = { url: string; init?: RequestInit };

function createFetchCapture(): { captured: CapturedRequest[]; mock: typeof fetch } {
  const captured: CapturedRequest[] = [];
  const mock = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    captured.push({ url, init });
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }) as typeof fetch;
  return { captured, mock };
}

async function withFetchMock<T>(mock: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();
  TestLogger.info('=== Starting Manual Test: Phase 2 — Frontend Integration & Pagination Fix ===', {
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
  // SECTION A: getSessionSeed() — session.ts
  // =========================================================================

  TestLogger.info('--- Section A: getSessionSeed() ---');

  tally(
    await runCheck('A1: first run generates a valid seed and stores it in sessionStorage', () => {
      const mock = createSessionStorageMock();
      const seed = withSessionStorage(mock, () => getSessionSeed());

      TestAssertion.assertTrue(
        Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SESSION_SEED,
        `generated seed ${seed} must be a safe integer in [0, ${MAX_SESSION_SEED}]`,
      );
      TestAssertion.assertEquals(
        1,
        mock.setItemCallArgs.length,
        'setItem must be called exactly once to persist the new seed',
      );
      TestAssertion.assertEquals(
        SEED_KEY,
        mock.setItemCallArgs[0]![0],
        `stored key must be "${SEED_KEY}"`,
      );
      TestAssertion.assertEquals(
        String(seed),
        mock.setItemCallArgs[0]![1],
        'stored value must equal the stringified seed',
      );
      TestLogger.info('A1 seed generated', { seed });
    }),
  );

  tally(
    await runCheck('A2: same-session reuse returns the stored seed without calling setItem', () => {
      const mock = createSessionStorageMock({ [SEED_KEY]: '98765' });
      const seed = withSessionStorage(mock, () => getSessionSeed());

      TestAssertion.assertEquals(98765, seed, 'must return the stored integer seed');
      TestAssertion.assertEquals(
        0,
        mock.setItemCallArgs.length,
        'setItem must NOT be called when a valid seed is already stored',
      );
      TestLogger.info('A2 reuse', { seed });
    }),
  );

  tally(
    await runCheck('A3: malformed stored value triggers regeneration', () => {
      const mock = createSessionStorageMock({ [SEED_KEY]: 'not-a-number' });
      const seed = withSessionStorage(mock, () => getSessionSeed());

      TestAssertion.assertTrue(
        Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SESSION_SEED,
        `replacement seed ${seed} must be a valid integer`,
      );
      TestAssertion.assertEquals(
        1,
        mock.setItemCallArgs.length,
        'setItem must be called once to store the replacement seed',
      );
      TestLogger.info('A3 regenerated after malformed value', { seed });
    }),
  );

  tally(
    await runCheck('A4: negative stored value triggers regeneration', () => {
      const mock = createSessionStorageMock({ [SEED_KEY]: '-5' });
      const seed = withSessionStorage(mock, () => getSessionSeed());

      TestAssertion.assertTrue(
        Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SESSION_SEED,
        `replacement seed ${seed} must be non-negative`,
      );
      TestAssertion.assertEquals(
        1,
        mock.setItemCallArgs.length,
        'setItem must be called once to replace the negative seed',
      );
      TestLogger.info('A4 regenerated after negative value', { seed });
    }),
  );

  tally(
    await runCheck('A5: generated seed is always within valid range (5 independent runs)', () => {
      for (let i = 0; i < 5; i++) {
        const mock = createSessionStorageMock();
        const seed = withSessionStorage(mock, () => getSessionSeed());
        TestAssertion.assertTrue(
          Number.isSafeInteger(seed) && seed >= 0 && seed <= MAX_SESSION_SEED,
          `run ${i + 1}: seed ${seed} must be in [0, ${MAX_SESSION_SEED}]`,
        );
      }
    }),
  );

  // =========================================================================
  // SECTION B: api.getDuels() URL construction — api.ts
  // =========================================================================

  TestLogger.info('--- Section B: api.getDuels() URL construction ---');

  tally(
    await runCheck('B1: seed param is appended when seed is provided', async () => {
      const { captured, mock } = createFetchCapture();
      await withFetchMock(mock, () => api.getDuels(1, undefined, 42));

      TestAssertion.assertEquals(1, captured.length, 'fetch must be called exactly once');
      const url = captured[0]!.url;
      TestAssertion.assertTrue(url.includes('seed=42'), `URL must contain seed=42 (got: ${url})`);
      TestAssertion.assertTrue(url.includes('page=1'), `URL must contain page=1 (got: ${url})`);
      TestAssertion.assertTrue(
        !url.includes('sort='),
        `URL must not contain sort= when only seed is provided (got: ${url})`,
      );
      TestLogger.info('B1 URL', { url });
    }),
  );

  tally(
    await runCheck('B2: sort=recent is appended without seed', async () => {
      const { captured, mock } = createFetchCapture();
      await withFetchMock(mock, () => api.getDuels(1, undefined, undefined, 'recent'));

      const url = captured[0]!.url;
      TestAssertion.assertTrue(
        url.includes('sort=recent'),
        `URL must contain sort=recent (got: ${url})`,
      );
      TestAssertion.assertTrue(
        !url.includes('seed='),
        `URL must not contain seed= when only sort is provided (got: ${url})`,
      );
      TestLogger.info('B2 URL', { url });
    }),
  );

  tally(
    await runCheck('B3: topic_id is included alongside seed', async () => {
      const { captured, mock } = createFetchCapture();
      await withFetchMock(mock, () => api.getDuels(1, 'nature', 99));

      const url = captured[0]!.url;
      TestAssertion.assertTrue(url.includes('seed=99'), `URL must contain seed=99 (got: ${url})`);
      TestAssertion.assertTrue(
        url.includes('topic_id=nature'),
        `URL must contain topic_id=nature (got: ${url})`,
      );
      TestLogger.info('B3 URL', { url });
    }),
  );

  tally(
    await runCheck('B4: topic_id is included alongside sort=recent', async () => {
      const { captured, mock } = createFetchCapture();
      await withFetchMock(mock, () => api.getDuels(1, 'love', undefined, 'recent'));

      const url = captured[0]!.url;
      TestAssertion.assertTrue(
        url.includes('sort=recent'),
        `URL must contain sort=recent (got: ${url})`,
      );
      TestAssertion.assertTrue(
        url.includes('topic_id=love'),
        `URL must contain topic_id=love (got: ${url})`,
      );
      TestLogger.info('B4 URL', { url });
    }),
  );

  tally(
    await runCheck('B5: no seed and no sort omits both params from the URL', async () => {
      const { captured, mock } = createFetchCapture();
      await withFetchMock(mock, () => api.getDuels(2));

      const url = captured[0]!.url;
      TestAssertion.assertTrue(!url.includes('seed='), `URL must not contain seed= (got: ${url})`);
      TestAssertion.assertTrue(!url.includes('sort='), `URL must not contain sort= (got: ${url})`);
      TestAssertion.assertTrue(url.includes('page=2'), `URL must contain page=2 (got: ${url})`);
      TestLogger.info('B5 URL', { url });
    }),
  );

  // =========================================================================
  // SECTION C: Static source verification
  // =========================================================================

  TestLogger.info('--- Section C: Static source verification ---');

  const homeSource = await Bun.file(HOME_PATH).text();
  const ringSource = await Bun.file(THE_RING_PATH).text();
  const boutsSource = await Bun.file(PAST_BOUTS_PATH).text();

  TestLogger.info('C source files loaded', {
    homeLines: homeSource.split('\n').length,
    ringLines: ringSource.split('\n').length,
    boutsLines: boutsSource.split('\n').length,
  });

  tally(
    await runCheck('C1: Home.tsx imports getSessionSeed from lib/session', () => {
      TestAssertion.assertTrue(
        homeSource.includes('getSessionSeed') && homeSource.includes('lib/session'),
        'Home.tsx must import getSessionSeed from ../lib/session',
      );
    }),
  );

  tally(
    await runCheck('C2: Home.tsx passes sessionSeedRef.current to api.getDuels', () => {
      TestAssertion.assertTrue(
        homeSource.includes('sessionSeedRef.current'),
        'Home.tsx must hold the seed in sessionSeedRef and pass .current to getDuels',
      );
      TestAssertion.assertTrue(
        homeSource.includes('getDuels('),
        'Home.tsx must call api.getDuels()',
      );
    }),
  );

  tally(
    await runCheck(`C3: TheRing.tsx defines PAGE_SIZE = ${EXPECTED_PAGE_SIZE}`, () => {
      TestAssertion.assertTrue(
        ringSource.includes(`PAGE_SIZE = ${EXPECTED_PAGE_SIZE}`),
        `TheRing.tsx must define PAGE_SIZE = ${EXPECTED_PAGE_SIZE} to match the API page size`,
      );
    }),
  );

  tally(
    await runCheck('C4: TheRing.tsx imports getSessionSeed from lib/session', () => {
      TestAssertion.assertTrue(
        ringSource.includes('getSessionSeed') && ringSource.includes('lib/session'),
        'TheRing.tsx must import getSessionSeed from ../lib/session',
      );
    }),
  );

  tally(
    await runCheck('C5: TheRing.tsx uses sessionSeedRef.current in ≥2 getDuels call sites', () => {
      const occurrences = ringSource.split('sessionSeedRef.current').length - 1;
      TestAssertion.assertTrue(
        occurrences >= 2,
        `TheRing.tsx must pass sessionSeedRef.current to getDuels in ≥2 places — ` +
          `queue bootstrap and incremental fetch (found ${occurrences})`,
      );
      TestLogger.info('C5 sessionSeedRef.current occurrences', { occurrences });
    }),
  );

  tally(
    await runCheck("C6: PastBouts.tsx passes 'recent' as the sort argument to getDuels", () => {
      TestAssertion.assertTrue(
        boutsSource.includes("'recent'"),
        "PastBouts.tsx must pass 'recent' to api.getDuels() for chronological ordering",
      );
      TestAssertion.assertTrue(
        boutsSource.includes('getDuels('),
        'PastBouts.tsx must call api.getDuels()',
      );
    }),
  );

  tally(
    await runCheck(
      'C7: PastBouts.tsx does not import or use getSessionSeed (uses sort=recent path only)',
      () => {
        TestAssertion.assertTrue(
          !boutsSource.includes('getSessionSeed'),
          'PastBouts.tsx must NOT use getSessionSeed — archive browsing is seeded only by sort=recent',
        );
      },
    ),
  );

  // =========================================================================
  // SECTION D: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section D: Automated test suite ---');

  tally(
    await runCheck('D1: pnpm --filter @sanctuary/web test exits 0', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/web', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('D1 test output', { exitCode, stdout: stdout.trim().slice(-1200) });
      if (stderr.trim()) TestLogger.warning('D1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web test suite must exit 0');
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
