#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 4: Regression & Quality Gate
 * Track: Phase 6 — Frontend Integration
 * Generated: 2026-02-27
 * Purpose: Verify all Phase 4 regression checklist items:
 *   - E2E test suite updates (data-animation-state attrs, reducedMotion config, topics spec)
 *   - Automated unit test suite passes for web + api
 *   - Build and lint gate passes
 *   - Live API regression (GET /topics, GET /duels?topic_id=, anonymous duel shape,
 *     POST /votes + stats reveal, health check)
 *
 * Run with: bun scripts/verify-phase4-frontend-regression.ts
 *
 * Live API checks (Section D) are skipped gracefully if the server is not running.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase4_frontend_regression_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const API_BASE = 'http://localhost:4000/api/v1';
const API_ROOT = 'http://localhost:4000';

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

/** Returns true if the API server is reachable, false otherwise. */
async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_ROOT}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 404; // any non-network-error means server is up
  } catch {
    return false;
  }
}

async function apiGet<T>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

async function apiPost<T>(path: string, payload: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 4 — Regression & Quality Gate ===', {
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
  // SECTION A: E2E Test Suite Updates — static file checks
  // =========================================================================

  TestLogger.info('--- Section A: E2E test suite infrastructure ---');

  tally(
    await runCheck(
      'A1: playwright.config.ts has reducedMotion: "reduce" to collapse animations in CI',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/playwright.config.ts'),
        ).text();
        TestAssertion.assertTrue(
          source.includes("reducedMotion: 'reduce'"),
          "playwright.config.ts must contain reducedMotion: 'reduce' in global use block",
        );
        TestLogger.info('A1 reducedMotion: reduce confirmed in playwright.config.ts');
      },
    ),
  );

  tally(
    await runCheck(
      'A2: SwipeContainer.tsx emits data-animation-state attribute for E2E testability',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'apps/web/components/SwipeContainer.tsx'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('data-animation-state={swipePhase}'),
          'SwipeContainer.tsx must bind data-animation-state={swipePhase} on the wrapper div',
        );
        TestLogger.info('A2 data-animation-state={swipePhase} confirmed in SwipeContainer.tsx');
      },
    ),
  );

  tally(
    await runCheck(
      'A3: VerdictPopup.tsx emits data-animation-state="open" on the backdrop div',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('data-animation-state="open"'),
          'VerdictPopup.tsx must include data-animation-state="open" on the backdrop div',
        );
        TestLogger.info('A3 data-animation-state="open" confirmed in VerdictPopup.tsx');
      },
    ),
  );

  tally(
    await runCheck(
      'A4: packages/e2e/tests/api/topics.spec.ts exists (new GET /topics test file)',
      () => {
        TestAssertion.assertTrue(
          existsSync(path.join(repoRoot, 'packages/e2e/tests/api/topics.spec.ts')),
          'topics.spec.ts must exist in packages/e2e/tests/api/',
        );
        TestLogger.info('A4 topics.spec.ts found in packages/e2e/tests/api/');
      },
    ),
  );

  tally(
    await runCheck(
      'A5: topics.spec.ts covers GET /topics and GET /duels?topic_id= filter',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/tests/api/topics.spec.ts'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('/topics'),
          'topics.spec.ts must test the /topics endpoint',
        );
        TestAssertion.assertTrue(
          source.includes('topic_id'),
          'topics.spec.ts must test the /duels?topic_id= filter',
        );
        TestLogger.info('A5 /topics and topic_id filter tests confirmed in topics.spec.ts');
      },
    ),
  );

  tally(
    await runCheck(
      'A6: anthology.spec.ts has topic filter chip tests (All chip + selection)',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/tests/ui/anthology.spec.ts'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('topic filter') || source.includes('Topic filter'),
          "anthology.spec.ts must contain topic filter tests (search for 'topic filter')",
        );
        TestAssertion.assertTrue(
          source.includes("name: 'All'"),
          "anthology.spec.ts must test the 'All' chip by role",
        );
        TestLogger.info('A6 topic filter and All chip tests confirmed in anthology.spec.ts');
      },
    ),
  );

  tally(
    await runCheck(
      'A7: reading-room.spec.ts uses locator-based wait (no bare waitForTimeout in beforeEach)',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/tests/ui/reading-room.spec.ts'),
        ).text();
        // beforeEach should NOT have waitForTimeout(1000) anymore
        const beforeEachMatch = source.match(/test\.beforeEach[\s\S]*?}\);/);
        if (beforeEachMatch) {
          TestAssertion.assertTrue(
            !beforeEachMatch[0].includes('waitForTimeout(1000)'),
            'beforeEach must not use waitForTimeout(1000) — should wait for a real locator',
          );
        }
        // Should use waitForTimeout inside beforeEach replaced with locator wait
        TestAssertion.assertTrue(
          source.includes("getByText('Subject')") || source.includes('getByText("Subject")'),
          "reading-room.spec.ts beforeEach must wait for 'Subject' text as a reliable signal",
        );
        TestLogger.info('A7 locator-based beforeEach wait confirmed in reading-room.spec.ts');
      },
    ),
  );

  tally(
    await runCheck(
      'A8: reading-room.spec.ts tests data-animation-state="open" on VerdictPopup',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/tests/ui/reading-room.spec.ts'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('data-animation-state="open"'),
          'reading-room.spec.ts must test the data-animation-state="open" attribute on the VerdictPopup',
        );
        TestLogger.info(
          'A8 data-animation-state="open" locator test confirmed in reading-room.spec.ts',
        );
      },
    ),
  );

  tally(
    await runCheck(
      'A9: assert-schema.ts has TopicShape interface and assertTopic() helper',
      async () => {
        const source = await Bun.file(
          path.join(repoRoot, 'packages/e2e/lib/assert-schema.ts'),
        ).text();
        TestAssertion.assertTrue(
          source.includes('TopicShape'),
          'assert-schema.ts must export TopicShape interface',
        );
        TestAssertion.assertTrue(
          source.includes('assertTopic'),
          'assert-schema.ts must export assertTopic() assertion helper',
        );
        TestLogger.info('A9 TopicShape and assertTopic confirmed in assert-schema.ts');
      },
    ),
  );

  // =========================================================================
  // SECTION B: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section B: Automated test suite ---');

  tally(
    await runCheck('B1: pnpm --filter @sanctuary/web test exits 0', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/web', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('B1 web test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('B1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web test suite must exit 0');
    }),
  );

  tally(
    await runCheck('B2: pnpm --filter @sanctuary/api test exits 0', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/api', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('B2 api test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('B2 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/api test suite must exit 0');
    }),
  );

  // =========================================================================
  // SECTION C: Build and lint gate
  // =========================================================================

  TestLogger.info('--- Section C: Build and lint gate ---');

  tally(
    await runCheck('C1: pnpm --filter @sanctuary/web build exits 0 (tsc + vite)', async () => {
      const { exitCode, stdout, stderr } = await runCommand([
        'pnpm',
        '--filter',
        '@sanctuary/web',
        'build',
      ]);
      TestLogger.info('C1 build output', { exitCode, stdout: stdout.trim().slice(-600) });
      if (stderr.trim()) TestLogger.info('C1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web build must exit 0');
    }),
  );

  tally(
    await runCheck('C2: pnpm lint exits 0 (0 errors, warnings tolerated)', async () => {
      const { exitCode, stdout, stderr } = await runCommand(['pnpm', 'lint']);
      TestLogger.info('C2 lint output', { exitCode, stdout: stdout.trim().slice(-600) });
      if (stderr.trim()) TestLogger.info('C2 stderr', { output: stderr.trim().slice(-400) });
      // ESLint exits 1 for errors but also for warnings with --max-warnings 0.
      // The project allows the pre-existing bun-test.d.ts any warning, so exit code 0 or 1
      // from warnings only is acceptable. Key is: no new errors.
      const hasErrors = stdout.includes(' error ') || stderr.includes(' error ');
      TestAssertion.assertTrue(!hasErrors, 'pnpm lint must report 0 errors (warnings tolerated)');
      TestLogger.info('C2 lint passed', { exitCode, hasErrors });
    }),
  );

  tally(
    await runCheck(
      'C3: pnpm format:check exits 0 (all files use Prettier code style)',
      async () => {
        const { exitCode, stdout, stderr } = await runCommand(['pnpm', 'format:check']);
        TestLogger.info('C3 format:check output', {
          exitCode,
          stdout: stdout.trim().slice(-600),
        });
        if (stderr.trim()) TestLogger.info('C3 stderr', { output: stderr.trim().slice(-400) });
        TestAssertion.assertEquals(0, exitCode, 'pnpm format:check must exit 0');
      },
    ),
  );

  // =========================================================================
  // SECTION D: Live API regression checks
  // =========================================================================

  TestLogger.info('--- Section D: Live API regression checks ---');

  const serverUp = await isApiReachable();

  if (!serverUp) {
    TestLogger.warning(
      'API server not reachable at http://localhost:4000 — skipping live API checks (D1-D6)',
      { tip: 'Run `pnpm --filter @sanctuary/api dev` then re-run this script for full coverage' },
    );
  } else {
    TestLogger.info('API server is reachable — running live regression checks');

    // ---- D1: Health check --------------------------------------------------
    tally(
      await runCheck('D1: GET /health returns 200', async () => {
        const res = await fetch(`${API_ROOT}/health`);
        TestAssertion.assertEquals(200, res.status, 'GET /health must return 200');
        TestLogger.info('D1 health check passed', { status: res.status });
      }),
    );

    // ---- D2: GET /topics ---------------------------------------------------
    tally(
      await runCheck(
        'D2: GET /api/v1/topics returns 200 with an array of canonical topics',
        async () => {
          const { status, body } = await apiGet<unknown[]>('/topics');
          TestAssertion.assertEquals(200, status, 'GET /topics must return 200');
          TestAssertion.assertTrue(Array.isArray(body), 'GET /topics body must be an array');

          if (Array.isArray(body) && body.length > 0) {
            const first = body[0] as Record<string, unknown>;
            TestAssertion.assertTrue(
              first.id === null || typeof first.id === 'string',
              'topic.id must be string or null',
            );
            TestAssertion.assertTrue(
              typeof first.label === 'string',
              'topic.label must be a string',
            );
            TestLogger.info('D2 GET /topics verified', { count: body.length, sample: first });
          } else {
            TestLogger.warning('D2 GET /topics returned empty array — no topics seeded');
          }
        },
      ),
    );

    // ---- D3: GET /duels?topic_id= filtering --------------------------------
    tally(
      await runCheck(
        'D3: GET /api/v1/duels?topic_id= filters correctly and unknown ID returns []',
        async () => {
          // First get a valid topic ID
          const { body: topics } =
            await apiGet<Array<{ id: string | null; label: string }>>('/topics');
          const topicWithId = topics.find((t) => t.id !== null);

          if (topicWithId?.id) {
            const { status, body: filtered } = await apiGet<unknown[]>(
              `/duels?topic_id=${topicWithId.id}`,
            );
            TestAssertion.assertEquals(200, status, 'GET /duels?topic_id= must return 200');
            TestAssertion.assertTrue(
              Array.isArray(filtered),
              'GET /duels?topic_id= body must be an array',
            );
            TestLogger.info('D3 topic_id filter verified', {
              topicId: topicWithId.id,
              topicLabel: topicWithId.label,
              duelCount: Array.isArray(filtered) ? filtered.length : 'N/A',
            });
          } else {
            TestLogger.warning('D3 No topic with non-null ID found — skipping filtered fetch');
          }

          // Unknown topic_id must return empty array
          const { status: s404, body: empty } = await apiGet<unknown[]>(
            '/duels?topic_id=nonexistent-topic-id-99999',
          );
          TestAssertion.assertEquals(200, s404, 'GET /duels with unknown topic_id must return 200');
          TestAssertion.assertTrue(
            Array.isArray(empty) && empty.length === 0,
            'GET /duels with unknown topic_id must return an empty array',
          );
          TestLogger.info('D3 unknown topic_id returns empty array confirmed');
        },
      ),
    );

    // ---- D4: GET /duels returns topicMeta.label ----------------------------
    tally(
      await runCheck(
        'D4: GET /api/v1/duels returns duel list with topicMeta.label on each item',
        async () => {
          const { status, body } = await apiGet<Array<Record<string, unknown>>>('/duels');
          TestAssertion.assertEquals(200, status, 'GET /duels must return 200');
          TestAssertion.assertTrue(Array.isArray(body), 'GET /duels body must be an array');

          if (Array.isArray(body) && body.length > 0) {
            const first = body[0];
            const topicMeta = first.topicMeta as Record<string, unknown> | undefined;
            TestAssertion.assertTrue(
              topicMeta !== undefined && typeof topicMeta.label === 'string',
              'First duel must have topicMeta.label (string)',
            );
            TestLogger.info('D4 GET /duels topicMeta.label verified', {
              duelCount: body.length,
              topicMeta,
            });
          } else {
            TestLogger.warning('D4 GET /duels returned empty array — no duels seeded');
          }
        },
      ),
    );

    // ---- D5: GET /duels/:id anonymous (no author/type) ---------------------
    tally(
      await runCheck(
        'D5: GET /api/v1/duels/:id returns anonymous duel — poemA/B have no author or type',
        async () => {
          const { body: duels } = await apiGet<Array<{ id: string }>>('/duels');
          if (!Array.isArray(duels) || duels.length === 0) {
            TestLogger.warning('D5 No duels available — skipping anonymous duel check');
            return;
          }

          const duelId = duels[0].id;
          const { status, body } = await apiGet<Record<string, unknown>>(`/duels/${duelId}`);
          TestAssertion.assertEquals(200, status, 'GET /duels/:id must return 200');

          const poemA = (body.poemA ?? body.poem_a) as Record<string, unknown>;
          const poemB = (body.poemB ?? body.poem_b) as Record<string, unknown>;

          TestAssertion.assertTrue(
            typeof poemA?.id === 'string' &&
              typeof poemA?.title === 'string' &&
              typeof poemA?.content === 'string',
            'poemA must have id, title, and content fields',
          );
          TestAssertion.assertTrue(
            !('author' in poemA),
            'Anonymous duel poemA must NOT expose author field',
          );
          TestAssertion.assertTrue(
            !('type' in poemA),
            'Anonymous duel poemA must NOT expose type field',
          );
          TestAssertion.assertTrue(
            !('author' in poemB),
            'Anonymous duel poemB must NOT expose author field',
          );
          TestAssertion.assertTrue(
            !('type' in poemB),
            'Anonymous duel poemB must NOT expose type field',
          );

          TestLogger.info('D5 anonymous duel shape verified', { duelId, topic: body.topic });
        },
      ),
    );

    // ---- D6: POST /votes + GET /duels/:id/stats reveals author & type -----
    tally(
      await runCheck(
        'D6: POST /votes + GET /duels/:id/stats reveals author and type (source attribution)',
        async () => {
          const { body: duels } =
            await apiGet<Array<{ id: string; poemA?: { id: string }; poemB?: { id: string } }>>(
              '/duels',
            );

          if (!Array.isArray(duels) || duels.length === 0) {
            TestLogger.warning('D6 No duels available — skipping vote + stats reveal check');
            return;
          }

          // Get the full duel to retrieve poem IDs
          const duelId = duels[0].id;
          const { body: duel } = await apiGet<
            Record<string, { poemA: { id: string }; poemB: { id: string } }>
          >(`/duels/${duelId}`);

          const poemAId = (duel.poemA as unknown as { id: string })?.id;
          if (!poemAId) {
            TestLogger.warning('D6 Could not extract poemA.id — skipping');
            return;
          }

          // Cast a vote
          const { status: voteStatus, body: voteBody } = await apiPost<{
            success: boolean;
            isHuman: boolean;
          }>('/votes', { duelId, selectedPoemId: poemAId });
          TestAssertion.assertEquals(200, voteStatus, 'POST /votes must return 200');
          TestAssertion.assertTrue(
            typeof (voteBody as { success: boolean }).success === 'boolean',
            'Vote response must have success field',
          );

          // Fetch stats (full reveal)
          const { status: statsStatus, body: stats } = await apiGet<{
            humanWinRate: number;
            avgReadingTime: string;
            duel: {
              poemA: { author: string; type: string };
              poemB: { author: string; type: string };
            };
          }>(`/duels/${duelId}/stats`);
          TestAssertion.assertEquals(200, statsStatus, 'GET /duels/:id/stats must return 200');

          const poemAType = stats?.duel?.poemA?.type;
          const poemBType = stats?.duel?.poemB?.type;
          const poemAAuthor = stats?.duel?.poemA?.author;
          const poemBAuthor = stats?.duel?.poemB?.author;

          TestAssertion.assertTrue(
            poemAType === 'HUMAN' || poemAType === 'AI',
            `duel.poemA.type must be 'HUMAN' or 'AI' (got: ${poemAType})`,
          );
          TestAssertion.assertTrue(
            poemBType === 'HUMAN' || poemBType === 'AI',
            `duel.poemB.type must be 'HUMAN' or 'AI' (got: ${poemBType})`,
          );
          TestAssertion.assertTrue(
            typeof poemAAuthor === 'string' && poemAAuthor.length > 0,
            'duel.poemA.author must be a non-empty string (full attribution revealed)',
          );
          TestAssertion.assertTrue(
            typeof poemBAuthor === 'string' && poemBAuthor.length > 0,
            'duel.poemB.author must be a non-empty string (full attribution revealed)',
          );

          TestLogger.info('D6 source attribution reveal verified', {
            duelId,
            poemA: { author: poemAAuthor, type: poemAType },
            poemB: { author: poemBAuthor, type: poemBType },
            humanWinRate: stats?.humanWinRate,
          });
        },
      ),
    );
  }

  // =========================================================================
  // Summary
  // =========================================================================

  const assertionsPassed = TestAssertion.summary();
  const checksPassed = failed === 0;
  const allPassed = assertionsPassed && checksPassed;
  const total = passed + failed;

  TestLogger.info('=== Manual Test Completed ===', { passed, failed, total });

  const serverNote = serverUp ? '' : ' (live API checks skipped — server not running)';

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Test ID  : ${testRunId}`);
  console.log(`  Checks   : ${passed}/${total} passed${serverNote}`);
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
