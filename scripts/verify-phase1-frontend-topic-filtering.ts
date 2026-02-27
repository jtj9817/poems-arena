#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 1: Topic Filtering Infrastructure
 * Track: Phase 6 — Frontend Integration
 * Generated: 2026-02-26
 * Purpose: Verify api.ts topic support, TopicBar component, BottomSheetFilter component,
 *          and Anthology.tsx integration with dynamic topic filtering.
 *
 * Run with: bun scripts/verify-phase1-frontend-topic-filtering.ts
 *
 * No live server required. API client behaviour is verified by mocking globalThis.fetch.
 * Component contracts are verified by reading source files directly.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { api } from '../apps/web/lib/api';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase1_topic_filtering_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

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

/**
 * Temporarily replace globalThis.fetch with a mock that captures the URL and
 * returns `responseData` as JSON. Restores the original fetch in a finally block.
 */
async function withMockFetch(
  responseData: unknown,
  fn: (getUrl: () => string) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';

  globalThis.fetch = (async (url: RequestInfo | URL) => {
    capturedUrl = String(url);
    const body = JSON.stringify(responseData);
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await fn(() => capturedUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 1 — Topic Filtering Infrastructure ===', {
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
  // SECTION A: File existence checks
  // =========================================================================

  TestLogger.info('--- Section A: Required files exist ---');

  tally(
    await runCheck('A1: apps/web/components/TopicBar.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/components/TopicBar.tsx')),
        'TopicBar.tsx must exist',
      );
    }),
  );

  tally(
    await runCheck('A2: apps/web/components/BottomSheetFilter.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/components/BottomSheetFilter.tsx')),
        'BottomSheetFilter.tsx must exist',
      );
    }),
  );

  tally(
    await runCheck('A3: apps/web/lib/api.test.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/lib/api.test.ts')),
        'api.test.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A4: apps/web/pages/Anthology.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/pages/Anthology.tsx')),
        'Anthology.tsx must exist',
      );
    }),
  );

  // =========================================================================
  // SECTION B: api.ts source code contracts
  // =========================================================================

  TestLogger.info('--- Section B: api.ts source code contracts ---');

  const apiSource = await Bun.file(path.join(repoRoot, 'apps/web/lib/api.ts')).text();

  tally(
    await runCheck('B1: DuelListItem includes topicMeta: TopicMeta field', () => {
      TestAssertion.assertTrue(
        apiSource.includes('topicMeta: TopicMeta'),
        'DuelListItem must have topicMeta: TopicMeta field',
      );
      TestLogger.info('B1 topicMeta field found in api.ts');
    }),
  );

  tally(
    await runCheck('B2: getTopics() function is defined in api.ts', () => {
      TestAssertion.assertTrue(
        apiSource.includes('getTopics()'),
        'api.ts must define getTopics() method',
      );
      TestLogger.info('B2 getTopics found in api.ts');
    }),
  );

  tally(
    await runCheck('B3: getDuels accepts optional topicId parameter', () => {
      TestAssertion.assertTrue(
        apiSource.includes('topicId?') || apiSource.includes('topicId?: string'),
        'getDuels must accept optional topicId parameter',
      );
      TestLogger.info('B3 topicId parameter found in api.ts');
    }),
  );

  tally(
    await runCheck('B4: getDuels uses URLSearchParams for query building', () => {
      TestAssertion.assertTrue(
        apiSource.includes('URLSearchParams'),
        'getDuels must use URLSearchParams to build the query string',
      );
      TestLogger.info('B4 URLSearchParams usage confirmed');
    }),
  );

  // =========================================================================
  // SECTION C: API client fetch behaviour (mock globalThis.fetch)
  // =========================================================================

  TestLogger.info('--- Section C: API client fetch behaviour ---');

  tally(
    await runCheck('C1: getTopics() calls URL ending in /topics', async () => {
      await withMockFetch([{ id: 't1', label: 'Nature' }], async (getUrl) => {
        const result = await api.getTopics();
        const url = getUrl();
        TestAssertion.assertTrue(url.endsWith('/topics'), 'getTopics must call /topics endpoint');
        TestAssertion.assertTrue(
          Array.isArray(result) && result.length === 1,
          'getTopics must return parsed JSON array',
        );
        TestLogger.info('C1 getTopics captured URL', { url });
      });
    }),
  );

  tally(
    await runCheck(
      'C2: getDuels(1) includes page=1 in URL and does NOT include topic_id',
      async () => {
        await withMockFetch([], async (getUrl) => {
          await api.getDuels(1);
          const url = getUrl();
          TestAssertion.assertTrue(url.includes('page=1'), 'getDuels(1) must include page=1');
          TestAssertion.assertTrue(
            !url.includes('topic_id'),
            'getDuels(1) must NOT include topic_id',
          );
          TestLogger.info('C2 getDuels(1) captured URL', { url });
        });
      },
    ),
  );

  tally(
    await runCheck(
      "C3: getDuels(1, 'topic-abc') includes both page=1 and topic_id=topic-abc",
      async () => {
        await withMockFetch([], async (getUrl) => {
          await api.getDuels(1, 'topic-abc');
          const url = getUrl();
          TestAssertion.assertTrue(url.includes('page=1'), 'must include page=1');
          TestAssertion.assertTrue(
            url.includes('topic_id=topic-abc'),
            'must include topic_id=topic-abc',
          );
          TestLogger.info('C3 getDuels with topicId captured URL', { url });
        });
      },
    ),
  );

  tally(
    await runCheck('C4: getDuels(1, undefined) does NOT include topic_id', async () => {
      await withMockFetch([], async (getUrl) => {
        await api.getDuels(1, undefined);
        const url = getUrl();
        TestAssertion.assertTrue(
          !url.includes('topic_id'),
          'getDuels with undefined topicId must NOT include topic_id',
        );
        TestLogger.info('C4 getDuels(1, undefined) captured URL', { url });
      });
    }),
  );

  tally(
    await runCheck('C5: getDuels() with no args defaults to page=1', async () => {
      await withMockFetch([], async (getUrl) => {
        await api.getDuels();
        const url = getUrl();
        TestAssertion.assertTrue(
          url.includes('page=1'),
          'getDuels() with no args must default to page=1',
        );
        TestLogger.info('C5 getDuels() default page captured URL', { url });
      });
    }),
  );

  // =========================================================================
  // SECTION D: TopicBar source code contract
  // =========================================================================

  TestLogger.info('--- Section D: TopicBar component contract ---');

  const topicBarSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/TopicBar.tsx'),
  ).text();

  tally(
    await runCheck('D1: TopicBar uses overflow-x-auto for horizontal scroll', () => {
      TestAssertion.assertTrue(
        topicBarSource.includes('overflow-x-auto'),
        'TopicBar must use overflow-x-auto for horizontal scrolling',
      );
      TestLogger.info('D1 overflow-x-auto found in TopicBar');
    }),
  );

  tally(
    await runCheck('D2: TopicBar renders an "All" chip that maps to null topicId', () => {
      TestAssertion.assertTrue(
        topicBarSource.includes('onSelect(null)'),
        'TopicBar "All" chip must call onSelect(null)',
      );
      TestAssertion.assertTrue(
        topicBarSource.includes('All'),
        'TopicBar must render an "All" label',
      );
      TestLogger.info('D2 "All" chip with null onSelect confirmed');
    }),
  );

  tally(
    await runCheck('D3: TopicBar applies distinct active style when activeTopicId matches', () => {
      TestAssertion.assertTrue(
        topicBarSource.includes('activeTopicId === topic.id') ||
          topicBarSource.includes('activeTopicId===topic.id'),
        'TopicBar must conditionally apply active style based on activeTopicId',
      );
      TestLogger.info('D3 active style conditional found in TopicBar');
    }),
  );

  // =========================================================================
  // SECTION E: BottomSheetFilter source code contract
  // =========================================================================

  TestLogger.info('--- Section E: BottomSheetFilter component contract ---');

  const bsfSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/BottomSheetFilter.tsx'),
  ).text();

  tally(
    await runCheck('E1: BottomSheetFilter uses translateY for slide animation', () => {
      TestAssertion.assertTrue(
        bsfSource.includes('translateY'),
        'BottomSheetFilter must use CSS translateY for sheet slide animation',
      );
      TestLogger.info('E1 translateY found in BottomSheetFilter');
    }),
  );

  tally(
    await runCheck('E2: BottomSheetFilter has opacity transition for backdrop', () => {
      TestAssertion.assertTrue(
        bsfSource.includes('opacity'),
        'BottomSheetFilter backdrop must use opacity for fade transition',
      );
      TestAssertion.assertTrue(
        bsfSource.includes('transition'),
        'BottomSheetFilter must define CSS transitions',
      );
      TestLogger.info('E2 opacity transition found in BottomSheetFilter');
    }),
  );

  tally(
    await runCheck(
      'E3: BottomSheetFilter calls onClose on backdrop click and after selection',
      () => {
        TestAssertion.assertTrue(
          bsfSource.includes('onClick={onClose}'),
          'BottomSheetFilter backdrop must call onClose on click',
        );
        TestAssertion.assertTrue(
          bsfSource.includes('onClose()'),
          'BottomSheetFilter must call onClose() after a topic is selected',
        );
        TestLogger.info('E3 onClose integration confirmed in BottomSheetFilter');
      },
    ),
  );

  // =========================================================================
  // SECTION F: Anthology.tsx integration
  // =========================================================================

  TestLogger.info('--- Section F: Anthology.tsx integration ---');

  const anthologySource = await Bun.file(
    path.join(repoRoot, 'apps/web/pages/Anthology.tsx'),
  ).text();

  tally(
    await runCheck('F1: Anthology.tsx imports TopicBar and BottomSheetFilter', () => {
      TestAssertion.assertTrue(
        anthologySource.includes("from '../components/TopicBar'"),
        'Anthology must import TopicBar',
      );
      TestAssertion.assertTrue(
        anthologySource.includes("from '../components/BottomSheetFilter'"),
        'Anthology must import BottomSheetFilter',
      );
      TestLogger.info('F1 TopicBar and BottomSheetFilter imports confirmed');
    }),
  );

  tally(
    await runCheck('F2: Anthology.tsx calls api.getTopics()', () => {
      TestAssertion.assertTrue(
        anthologySource.includes('api.getTopics()'),
        'Anthology must call api.getTopics() to fetch topics',
      );
      TestLogger.info('F2 api.getTopics() call confirmed in Anthology');
    }),
  );

  tally(
    await runCheck('F3: Anthology.tsx uses topicMeta.label for display (not duel.topic)', () => {
      TestAssertion.assertTrue(
        anthologySource.includes('topicMeta.label'),
        'Anthology must display topicMeta.label on duel cards',
      );
      TestLogger.info('F3 topicMeta.label usage confirmed in Anthology');
    }),
  );

  tally(
    await runCheck(
      'F4: Anthology.tsx passes activeTopicId to getDuels for filtered fetching',
      () => {
        TestAssertion.assertTrue(
          anthologySource.includes('activeTopicId'),
          'Anthology must maintain and pass activeTopicId state for topic filtering',
        );
        TestAssertion.assertTrue(
          anthologySource.includes('getDuels('),
          'Anthology must call api.getDuels() with topic filter support',
        );
        TestLogger.info('F4 activeTopicId state + getDuels call confirmed in Anthology');
      },
    ),
  );

  // =========================================================================
  // SECTION G: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section G: Automated test suite ---');

  tally(
    await runCheck('G1: pnpm --filter @sanctuary/web test exits 0 (7 tests)', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/web', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('G1 test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('G1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web test suite must exit 0');
    }),
  );

  tally(
    await runCheck(
      'G2: pnpm --filter @sanctuary/web build exits 0 (tsc + vite build)',
      async () => {
        const { exitCode, stdout, stderr } = await runCommand([
          'pnpm',
          '--filter',
          '@sanctuary/web',
          'build',
        ]);
        TestLogger.info('G2 build output', { exitCode, stdout: stdout.trim().slice(-600) });
        if (stderr.trim()) TestLogger.info('G2 stderr', { output: stderr.trim().slice(-400) });
        TestAssertion.assertEquals(0, exitCode, '@sanctuary/web build must exit 0 (tsc + vite)');
      },
    ),
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
