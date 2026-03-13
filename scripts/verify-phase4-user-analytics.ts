#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 4: Frontend Tracking & Verdict UI
 * Generated: 2026-03-13
 * Purpose: Verify client-side decision-time tracking in The Ring,
 *          aggregate-backed Verdict UI rendering, and frontend test coverage.
 *
 * Run with: bun scripts/verify-phase4-user-analytics.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DataTracker, TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const testRunId = `phase4_user_analytics_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));
const STDERR_TAIL_CHARS = 500;
const TEST_STDOUT_TAIL_CHARS = 1200;

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
let allPassed = false;

function requireTrue(condition: boolean, message: string): void {
  const ok = TestAssertion.assertTrue(condition, message);
  if (!ok) throw new Error(message);
}

function requireEquals<T>(expected: T, actual: T, message: string): void {
  const ok = TestAssertion.assertEquals(expected, actual, message);
  if (!ok) throw new Error(message);
}

async function runCommand(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CommandResult> {
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

  return {
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  };
}

try {
  TestLogger.info('=== Starting Manual Test: User Analytics Phase 4 ===', { testRunId, logFile });

  TestLogger.startPhase('Setup');

  const requiredFiles = [
    'apps/web/pages/TheRing.tsx',
    'apps/web/components/VerdictPopup.tsx',
    'apps/web/components/VerdictPopup.test.tsx',
    'apps/web/lib/api.ts',
    'packages/shared/src/index.ts',
    'conductor/tracks/user_analytics_20260312/plan.md',
    'conductor/tracks/user_analytics_20260312/spec.md',
  ];

  for (const relPath of requiredFiles) {
    requireTrue(existsSync(path.join(repoRoot, relPath)), `Required file exists: ${relPath}`);
  }

  TestLogger.endPhase('Setup');

  TestLogger.startPhase('Frontend tracking checks');

  const theRingSource = readFileSync(path.join(repoRoot, 'apps/web/pages/TheRing.tsx'), 'utf8');

  requireTrue(
    /const\s+readingStartedAtRef\s*=\s*useRef<number>\(Date\.now\(\)\);/.test(theRingSource),
    'The Ring initializes a decision-time start timestamp ref',
  );

  requireTrue(
    /const readingTimeMs = Math\.max\(1, Math\.floor\(Date\.now\(\) - readingStartedAtRef\.current\)\);/.test(
      theRingSource,
    ),
    'The Ring computes readingTimeMs on vote submission using elapsed time',
  );

  requireTrue(
    /api\.vote\(\{ duelId: duel\.id, selectedPoemId: poemId, readingTimeMs \}\);/.test(
      theRingSource,
    ),
    'The Ring sends readingTimeMs in api.vote payload',
  );

  const timerResets = theRingSource.match(/readingStartedAtRef\.current = Date\.now\(\);/g) ?? [];
  requireTrue(
    timerResets.length >= 2,
    'The Ring resets decision-time timer for initial load and duel transitions',
  );

  requireTrue(
    /setTimeout\(\(\) => \{\s*setFadeIn\(true\);\s*readingStartedAtRef\.current = Date\.now\(\);\s*\}, 100\);/s.test(
      theRingSource,
    ),
    'The Ring resets timer when duel becomes visible/interactive on initial load',
  );

  requireTrue(
    /const handleSwipeInComplete = \(\) => \{\s*setSwipePhase\('idle'\);\s*readingStartedAtRef\.current = Date\.now\(\);\s*\};/s.test(
      theRingSource,
    ),
    'The Ring resets timer when swipe transition completes for next duel',
  );

  TestLogger.endPhase('Frontend tracking checks');

  TestLogger.startPhase('Verdict UI aggregate checks');

  const verdictPopupSource = readFileSync(
    path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx'),
    'utf8',
  );

  requireTrue(
    verdictPopupSource.includes(
      'const topicDelta = stats && stats.topicStats.humanWinRate - stats.globalStats.humanWinRate;',
    ),
    'Verdict UI computes topic vs global recognition-rate delta',
  );

  requireTrue(
    verdictPopupSource.includes('Recognition Rate') &&
      verdictPopupSource.includes('Global Average') &&
      verdictPopupSource.includes('Topic: {stats.topicStats.topicMeta.label}'),
    'Verdict UI renders global/topic recognition-rate labels',
  );

  requireTrue(
    verdictPopupSource.includes('style={{ width: `${stats.globalStats.humanWinRate}%` }}') &&
      verdictPopupSource.includes('style={{ width: `${stats.topicStats.humanWinRate}%` }}'),
    'Verdict UI renders recognition bars using aggregate percentages',
  );

  requireTrue(
    verdictPopupSource.includes("{topicDelta >= 0 ? '↑' : '↓'}") &&
      verdictPopupSource.includes('% vs global'),
    'Verdict UI renders directional delta indicator vs global',
  );

  requireTrue(
    verdictPopupSource.includes('Avg. Decision Time') &&
      verdictPopupSource.includes('{stats.globalStats.avgDecisionTime ??') &&
      verdictPopupSource.includes('{stats.topicStats.avgDecisionTime ??'),
    'Verdict UI renders global and topic avgDecisionTime from aggregates',
  );

  requireTrue(
    !verdictPopupSource.includes('avgReadingTime'),
    'Verdict UI no longer references avgReadingTime',
  );

  TestLogger.endPhase('Verdict UI aggregate checks');

  TestLogger.startPhase('Contract alignment checks');

  const sharedSource = readFileSync(path.join(repoRoot, 'packages/shared/src/index.ts'), 'utf8');
  requireTrue(
    /export interface VoteRequest \{[\s\S]*readingTimeMs: number;[\s\S]*\}/.test(sharedSource),
    'Shared VoteRequest contract requires readingTimeMs',
  );

  const webApiSource = readFileSync(path.join(repoRoot, 'apps/web/lib/api.ts'), 'utf8');
  requireTrue(
    webApiSource.includes('vote(payload: VoteRequest): Promise<VoteResponse>'),
    'Web API client vote call uses shared VoteRequest payload with readingTimeMs',
  );
  requireTrue(
    webApiSource.includes('getDuelStats(id: string): Promise<DuelStatsResponse>'),
    'Web API client exposes DuelStatsResponse for Verdict aggregates',
  );

  TestLogger.endPhase('Contract alignment checks');

  TestLogger.startPhase('Automated tests');

  const webTests = await runCommand(['pnpm', '--filter', '@sanctuary/web', 'test'], {
    env: { CI: 'true' },
  });
  TestLogger.info('Web test suite completed', {
    exitCode: webTests.exitCode,
    stdoutTail: webTests.stdout.trim().slice(-TEST_STDOUT_TAIL_CHARS),
    stderrTail: webTests.stderr.trim().slice(-STDERR_TAIL_CHARS),
  });
  requireEquals(
    0,
    webTests.exitCode,
    'Web tests pass for Phase 4 frontend verdict/tracking changes',
  );

  TestLogger.endPhase('Automated tests');

  allPassed = TestAssertion.summary();
  if (!allPassed) {
    throw new Error('One or more Phase 4 verification assertions failed.');
  }

  TestLogger.info('=== Manual Test Complete: PASS ===', {
    testRunId,
    logFile,
    summary: TestAssertion.counts(),
  });
} catch (error) {
  TestLogger.error('=== Manual Test Complete: FAIL ===', {
    testRunId,
    logFile,
    message: error instanceof Error ? error.message : String(error),
    summary: TestAssertion.counts(),
  });
} finally {
  await tracker.cleanup();
  process.exit(allPassed ? 0 : 1);
}
