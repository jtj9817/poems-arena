#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 2: Verdict Pop-Up & Swipe Transitions
 * Track: Phase 6 — Frontend Integration
 * Generated: 2026-02-26
 * Purpose: Verify VerdictPopup component, SwipeContainer component,
 *          sliding-window duelQueue utilities, and ReadingRoom.tsx integration.
 *
 * Run with: bun scripts/verify-phase2-frontend-verdict-swipe.ts
 *
 * No live server required. Pure functions are imported and exercised directly.
 * Component contracts are verified by reading source files.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import {
  createQueue,
  queueAdvance,
  queueAppendPage,
  queueCurrentId,
  queueNeedsMoreIds,
  queueNextIds,
} from '../apps/web/lib/duelQueue';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase2_verdict_swipe_${new Date().toISOString().replace(/[:.]/g, '_')}`;
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 2 — Verdict Pop-Up & Swipe Transitions ===', {
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
    await runCheck('A1: apps/web/lib/duelQueue.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/lib/duelQueue.ts')),
        'duelQueue.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A2: apps/web/lib/duelQueue.test.ts exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/lib/duelQueue.test.ts')),
        'duelQueue.test.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A3: apps/web/components/VerdictPopup.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx')),
        'VerdictPopup.tsx must exist',
      );
    }),
  );

  tally(
    await runCheck('A4: apps/web/components/SwipeContainer.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/components/SwipeContainer.tsx')),
        'SwipeContainer.tsx must exist',
      );
    }),
  );

  // =========================================================================
  // SECTION B: duelQueue pure function behaviour (direct import)
  // =========================================================================

  TestLogger.info('--- Section B: duelQueue pure function behaviour ---');

  tally(
    await runCheck('B1: createQueue() returns expected initial state', () => {
      const q = createQueue();
      TestAssertion.assertTrue(Array.isArray(q.ids), 'ids must be an array');
      TestAssertion.assertEquals(0, q.ids.length, 'ids must be empty');
      TestAssertion.assertEquals(0, q.currentIndex, 'currentIndex must start at 0');
      TestAssertion.assertEquals(1, q.currentPage, 'currentPage must start at 1');
      TestAssertion.assertTrue(q.hasMore, 'hasMore must default to true');
      TestLogger.info('B1 createQueue state verified', q);
    }),
  );

  tally(
    await runCheck(
      'B2: queueCurrentId() returns null for empty queue, correct id after append',
      () => {
        const empty = createQueue();
        TestAssertion.assertTrue(
          queueCurrentId(empty) === null,
          'queueCurrentId must return null for empty queue',
        );
        const withIds = queueAppendPage(empty, ['duel-a', 'duel-b', 'duel-c'], false);
        TestAssertion.assertEquals(
          'duel-a',
          queueCurrentId(withIds),
          'queueCurrentId must return first id after append',
        );
        const advanced = queueAdvance(withIds);
        TestAssertion.assertEquals(
          'duel-b',
          queueCurrentId(advanced),
          'queueCurrentId must return second id after advance',
        );
        TestLogger.info('B2 queueCurrentId verified');
      },
    ),
  );

  tally(
    await runCheck('B3: queueNextIds() returns up to count ids after current position', () => {
      const q = queueAppendPage(createQueue(), ['a', 'b', 'c', 'd', 'e'], false);
      const next2 = queueNextIds(q, 2);
      TestAssertion.assertEquals(2, next2.length, 'queueNextIds(q, 2) must return 2 ids');
      TestAssertion.assertEquals('b', next2[0]!, 'first next id must be b');
      TestAssertion.assertEquals('c', next2[1]!, 'second next id must be c');
      const next10 = queueNextIds(q, 10);
      TestAssertion.assertEquals(4, next10.length, 'queueNextIds must not exceed available ids');
      TestLogger.info('B3 queueNextIds verified', { next2, next10 });
    }),
  );

  tally(
    await runCheck('B4: queueAdvance() is immutable and increments currentIndex', () => {
      const original = queueAppendPage(createQueue(), ['x', 'y', 'z'], false);
      const advanced = queueAdvance(original);
      TestAssertion.assertEquals(0, original.currentIndex, 'original must not be mutated');
      TestAssertion.assertEquals(1, advanced.currentIndex, 'advanced must have currentIndex=1');
      TestAssertion.assertEquals('y', queueCurrentId(advanced), 'advanced must point to second id');
      TestLogger.info('B4 queueAdvance immutability verified');
    }),
  );

  tally(
    await runCheck('B5: queueAppendPage() accumulates ids and increments currentPage', () => {
      const q1 = queueAppendPage(createQueue(), ['p1', 'p2'], false);
      TestAssertion.assertEquals(2, q1.ids.length, 'first append must add 2 ids');
      TestAssertion.assertEquals(2, q1.currentPage, 'currentPage must be 2 after first append');
      TestAssertion.assertTrue(q1.hasMore, 'hasMore must remain true for non-last page');

      const q2 = queueAppendPage(q1, ['p3', 'p4'], true);
      TestAssertion.assertEquals(4, q2.ids.length, 'second append must total 4 ids');
      TestAssertion.assertEquals(3, q2.currentPage, 'currentPage must be 3 after second append');
      TestAssertion.assertTrue(!q2.hasMore, 'hasMore must be false for last page');
      TestLogger.info('B5 queueAppendPage accumulation verified');
    }),
  );

  tally(
    await runCheck('B6: queueNeedsMoreIds() returns correct values based on remaining ids', () => {
      const lastPage = queueAppendPage(createQueue(), ['a', 'b', 'c'], true);
      TestAssertion.assertTrue(
        !queueNeedsMoreIds(lastPage, 2),
        'must return false when hasMore is false',
      );

      const manyIds = queueAppendPage(createQueue(), ['a', 'b', 'c', 'd', 'e'], false);
      TestAssertion.assertTrue(
        !queueNeedsMoreIds(manyIds, 2),
        'must return false when plenty of ids remain (4 remaining > prefetchCount 2)',
      );

      const fewIds = queueAppendPage(createQueue(), ['a', 'b', 'c'], false);
      TestAssertion.assertTrue(
        queueNeedsMoreIds(fewIds, 2),
        'must return true when remaining ids <= prefetchCount (2 remaining = prefetchCount 2)',
      );

      const emptyHasMore = createQueue();
      TestAssertion.assertTrue(
        queueNeedsMoreIds(emptyHasMore, 2),
        'must return true for empty queue with hasMore=true',
      );
      TestLogger.info('B6 queueNeedsMoreIds thresholds verified');
    }),
  );

  // =========================================================================
  // SECTION C: duelQueue.ts source code contracts
  // =========================================================================

  TestLogger.info('--- Section C: duelQueue.ts source code contracts ---');

  const queueSource = await Bun.file(path.join(repoRoot, 'apps/web/lib/duelQueue.ts')).text();

  tally(
    await runCheck('C1: duelQueue.ts exports DuelQueueState interface with all fields', () => {
      TestAssertion.assertTrue(
        queueSource.includes('export interface DuelQueueState'),
        'must export DuelQueueState interface',
      );
      TestAssertion.assertTrue(queueSource.includes('ids:'), 'DuelQueueState must have ids field');
      TestAssertion.assertTrue(
        queueSource.includes('currentIndex:'),
        'DuelQueueState must have currentIndex field',
      );
      TestAssertion.assertTrue(
        queueSource.includes('currentPage:'),
        'DuelQueueState must have currentPage field',
      );
      TestAssertion.assertTrue(
        queueSource.includes('hasMore:'),
        'DuelQueueState must have hasMore field',
      );
      TestLogger.info('C1 DuelQueueState interface shape confirmed');
    }),
  );

  tally(
    await runCheck('C2: duelQueue.ts exports all 6 required functions', () => {
      const requiredExports = [
        'export function createQueue',
        'export function queueCurrentId',
        'export function queueNextIds',
        'export function queueAdvance',
        'export function queueAppendPage',
        'export function queueNeedsMoreIds',
      ];
      for (const exportSig of requiredExports) {
        TestAssertion.assertTrue(
          queueSource.includes(exportSig),
          `duelQueue.ts must export ${exportSig.split(' ')[2]}`,
        );
      }
      TestLogger.info('C2 all 6 queue exports confirmed');
    }),
  );

  // =========================================================================
  // SECTION D: VerdictPopup.tsx source code contracts
  // =========================================================================

  TestLogger.info('--- Section D: VerdictPopup.tsx source code contracts ---');

  const verdictSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx'),
  ).text();

  tally(
    await runCheck('D1: VerdictPopup returns null when isOpen is false', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('if (!isOpen) return null'),
        'VerdictPopup must return null when isOpen is false',
      );
      TestLogger.info('D1 early return null guard found in VerdictPopup');
    }),
  );

  tally(
    await runCheck('D2: VerdictPopup uses verdictIn CSS animation', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('verdictIn'),
        'VerdictPopup must reference the verdictIn CSS animation keyframe',
      );
      TestLogger.info('D2 verdictIn animation reference confirmed');
    }),
  );

  tally(
    await runCheck('D3: VerdictPopup renders verdict message based on poem type', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('You recognized the Human'),
        'VerdictPopup must render human-win verdict message',
      );
      TestAssertion.assertTrue(
        verdictSource.includes('You chose the Machine'),
        'VerdictPopup must render machine-win verdict message',
      );
      TestAssertion.assertTrue(
        verdictSource.includes('AuthorType.HUMAN'),
        'VerdictPopup must check AuthorType.HUMAN for verdict determination',
      );
      TestLogger.info('D3 verdict message logic confirmed');
    }),
  );

  tally(
    await runCheck(
      'D4: VerdictPopup renders stats (humanWinRate, avgReadingTime) and both action buttons',
      () => {
        TestAssertion.assertTrue(
          verdictSource.includes('humanWinRate'),
          'VerdictPopup must display stats.humanWinRate',
        );
        TestAssertion.assertTrue(
          verdictSource.includes('avgReadingTime'),
          'VerdictPopup must display stats.avgReadingTime',
        );
        TestAssertion.assertTrue(
          verdictSource.includes('onContinue'),
          'VerdictPopup must have onContinue button handler',
        );
        TestAssertion.assertTrue(
          verdictSource.includes('onReviewPoems'),
          'VerdictPopup must have onReviewPoems button handler',
        );
        TestLogger.info('D4 stats display and action buttons confirmed');
      },
    ),
  );

  // =========================================================================
  // SECTION E: SwipeContainer.tsx source code contracts
  // =========================================================================

  TestLogger.info('--- Section E: SwipeContainer.tsx source code contracts ---');

  const swipeSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/SwipeContainer.tsx'),
  ).text();

  tally(
    await runCheck(
      "E1: SwipeContainer exports SwipePhase type with 'idle' | 'swipe-out' | 'swipe-in'",
      () => {
        TestAssertion.assertTrue(
          swipeSource.includes('export type SwipePhase'),
          'SwipeContainer must export SwipePhase type',
        );
        TestAssertion.assertTrue(swipeSource.includes("'idle'"), "SwipePhase must include 'idle'");
        TestAssertion.assertTrue(
          swipeSource.includes("'swipe-out'"),
          "SwipePhase must include 'swipe-out'",
        );
        TestAssertion.assertTrue(
          swipeSource.includes("'swipe-in'"),
          "SwipePhase must include 'swipe-in'",
        );
        TestLogger.info('E1 SwipePhase type with all three values confirmed');
      },
    ),
  );

  tally(
    await runCheck(
      'E2: SwipeContainer applies swipeOutLeft animation during swipe-out phase',
      () => {
        TestAssertion.assertTrue(
          swipeSource.includes('swipeOutLeft'),
          'SwipeContainer must reference swipeOutLeft CSS animation keyframe',
        );
        TestLogger.info('E2 swipeOutLeft animation reference confirmed');
      },
    ),
  );

  tally(
    await runCheck(
      'E3: SwipeContainer applies swipeInRight animation during swipe-in phase',
      () => {
        TestAssertion.assertTrue(
          swipeSource.includes('swipeInRight'),
          'SwipeContainer must reference swipeInRight CSS animation keyframe',
        );
        TestLogger.info('E3 swipeInRight animation reference confirmed');
      },
    ),
  );

  tally(
    await runCheck(
      'E4: SwipeContainer dispatches onSwipeOutComplete / onSwipeInComplete from onAnimationEnd',
      () => {
        TestAssertion.assertTrue(
          swipeSource.includes('onAnimationEnd'),
          'SwipeContainer must use onAnimationEnd to detect animation completion',
        );
        TestAssertion.assertTrue(
          swipeSource.includes('onSwipeOutComplete()'),
          'SwipeContainer must call onSwipeOutComplete() from handleAnimationEnd',
        );
        TestAssertion.assertTrue(
          swipeSource.includes('onSwipeInComplete()'),
          'SwipeContainer must call onSwipeInComplete() from handleAnimationEnd',
        );
        TestLogger.info('E4 onAnimationEnd dispatch logic confirmed');
      },
    ),
  );

  // =========================================================================
  // SECTION F: index.html CSS keyframes
  // =========================================================================

  TestLogger.info('--- Section F: index.html CSS keyframes ---');

  const htmlSource = await Bun.file(path.join(repoRoot, 'apps/web/index.html')).text();

  tally(
    await runCheck('F1: index.html defines swipeOutLeft and swipeInRight keyframes', () => {
      TestAssertion.assertTrue(
        htmlSource.includes('@keyframes swipeOutLeft'),
        'index.html must define @keyframes swipeOutLeft',
      );
      TestAssertion.assertTrue(
        htmlSource.includes('@keyframes swipeInRight'),
        'index.html must define @keyframes swipeInRight',
      );
      TestLogger.info('F1 swipeOutLeft and swipeInRight keyframes confirmed in index.html');
    }),
  );

  tally(
    await runCheck('F2: index.html defines verdictIn keyframe for VerdictPopup entrance', () => {
      TestAssertion.assertTrue(
        htmlSource.includes('@keyframes verdictIn'),
        'index.html must define @keyframes verdictIn for popup entrance animation',
      );
      TestLogger.info('F2 verdictIn keyframe confirmed in index.html');
    }),
  );

  // =========================================================================
  // SECTION G: ReadingRoom.tsx integration markers
  // =========================================================================

  TestLogger.info('--- Section G: ReadingRoom.tsx integration ---');

  const readingRoomSource = await Bun.file(
    path.join(repoRoot, 'apps/web/pages/ReadingRoom.tsx'),
  ).text();

  tally(
    await runCheck('G1: ReadingRoom.tsx imports VerdictPopup and SwipeContainer', () => {
      TestAssertion.assertTrue(
        readingRoomSource.includes("from '../components/VerdictPopup'"),
        'ReadingRoom must import VerdictPopup',
      );
      TestAssertion.assertTrue(
        readingRoomSource.includes("from '../components/SwipeContainer'"),
        'ReadingRoom must import SwipeContainer',
      );
      TestLogger.info('G1 VerdictPopup and SwipeContainer imports confirmed in ReadingRoom');
    }),
  );

  tally(
    await runCheck('G2: ReadingRoom.tsx imports all 6 duelQueue functions', () => {
      const requiredImports = [
        'createQueue',
        'queueAppendPage',
        'queueAdvance',
        'queueCurrentId',
        'queueNextIds',
        'queueNeedsMoreIds',
      ];
      for (const fn of requiredImports) {
        TestAssertion.assertTrue(
          readingRoomSource.includes(fn),
          `ReadingRoom must import ${fn} from duelQueue`,
        );
      }
      TestLogger.info('G2 all duelQueue function imports confirmed in ReadingRoom');
    }),
  );

  tally(
    await runCheck(
      'G3: ReadingRoom.tsx has showPopup, hasVoted, and swipePhase state variables',
      () => {
        TestAssertion.assertTrue(
          readingRoomSource.includes('showPopup'),
          'ReadingRoom must use showPopup state',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('hasVoted'),
          'ReadingRoom must use hasVoted state',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('swipePhase'),
          'ReadingRoom must use swipePhase state',
        );
        TestLogger.info('G3 showPopup, hasVoted, swipePhase state variables confirmed');
      },
    ),
  );

  tally(
    await runCheck(
      'G4: ReadingRoom.tsx has handleContinue, handleSwipeOutComplete, handleSwipeInComplete',
      () => {
        TestAssertion.assertTrue(
          readingRoomSource.includes('handleContinue'),
          'ReadingRoom must define handleContinue handler',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('handleSwipeOutComplete'),
          'ReadingRoom must define handleSwipeOutComplete handler',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('handleSwipeInComplete'),
          'ReadingRoom must define handleSwipeInComplete handler',
        );
        TestLogger.info('G4 all three swipe handlers confirmed in ReadingRoom');
      },
    ),
  );

  tally(
    await runCheck(
      'G5: ReadingRoom.tsx uses queueRef and prefetchCacheRef for sliding window',
      () => {
        TestAssertion.assertTrue(
          readingRoomSource.includes('queueRef'),
          'ReadingRoom must use queueRef for queue state',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('prefetchCacheRef'),
          'ReadingRoom must use prefetchCacheRef for pre-fetch cache',
        );
        TestAssertion.assertTrue(
          readingRoomSource.includes('prefetchUpcoming'),
          'ReadingRoom must call prefetchUpcoming to pre-fetch next duels',
        );
        TestLogger.info('G5 sliding window refs and prefetch call confirmed in ReadingRoom');
      },
    ),
  );

  // =========================================================================
  // SECTION H: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section H: Automated test suite ---');

  tally(
    await runCheck('H1: pnpm --filter @sanctuary/web test exits 0 (30 tests)', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/web', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('H1 test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('H1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web test suite must exit 0');
    }),
  );

  tally(
    await runCheck(
      'H2: pnpm --filter @sanctuary/web build exits 0 (tsc + vite build)',
      async () => {
        const { exitCode, stdout, stderr } = await runCommand([
          'pnpm',
          '--filter',
          '@sanctuary/web',
          'build',
        ]);
        TestLogger.info('H2 build output', { exitCode, stdout: stdout.trim().slice(-600) });
        if (stderr.trim()) TestLogger.info('H2 stderr', { output: stderr.trim().slice(-400) });
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
