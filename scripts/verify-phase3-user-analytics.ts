#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 3: Verdict API & Data Fetching
 * Generated: 2026-03-13
 * Purpose: Verify stats payload shape, aggregate-backed decision-time fields,
 *          shared/web API contract alignment, and targeted automated tests.
 *
 * Run with: bun scripts/verify-phase3-user-analytics.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DataTracker, TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const testRunId = `phase3_user_analytics_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
const tempDbDir = path.join(tmpdir(), 'sanctuary_manual_tests');
const tempDbFile = path.join(tempDbDir, `${testRunId}.sqlite`);
const tempDbWal = `${tempDbFile}-wal`;
const tempDbShm = `${tempDbFile}-shm`;
const tempDbUrl = `file:${tempDbFile}`;

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

function parseJsonLine<T>(stdout: string): T {
  const lines = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i] ?? '') as T;
    } catch {
      // keep scanning
    }
  }

  throw new Error('Unable to parse JSON result from route-integration command output.');
}

function buildRouteIntegrationScript(): string {
  return String.raw`
    import { Hono } from 'hono';
    import { createDb } from '../../packages/db/src/client';
    import {
      duels,
      globalStatistics,
      poems,
      topicStatistics,
      topics,
    } from '../../packages/db/src/schema';
    import { createDuelsRouter } from './src/routes/duels';

    const db = createDb({
      url: process.env.LIBSQL_URL,
      authToken: process.env.LIBSQL_AUTH_TOKEN,
    });

    try {
      const app = new Hono();
      app.route('/', createDuelsRouter(db));

      await db.insert(topics).values({ id: 'topic-nature', label: 'Nature' });
      await db.insert(poems).values([
        {
          id: 'poem-human-1',
          title: 'Human Seed',
          content: 'wind river mountain',
          author: 'Manual Tester',
          type: 'HUMAN',
        },
        {
          id: 'poem-ai-1',
          title: 'AI Seed',
          content: 'silicon moon',
          author: 'Manual Tester',
          type: 'AI',
        },
      ]);
      await db.insert(duels).values({
        id: 'duel-001',
        topic: 'Nature',
        topicId: 'topic-nature',
        poemAId: 'poem-human-1',
        poemBId: 'poem-ai-1',
      });

      const emptyStatsRes = await app.request('/duel-001/stats');
      const emptyStats = await emptyStatsRes.json();

      await db.insert(globalStatistics).values({
        id: 'global',
        totalVotes: 12,
        humanVotes: 9,
        decisionTimeSumMs: 1_440_000, // avg = 120000 => 2m 00s
        decisionTimeCount: 12,
      });
      await db.insert(topicStatistics).values({
        topicId: 'topic-nature',
        topicLabel: 'Nature',
        totalVotes: 8,
        humanVotes: 6,
        decisionTimeSumMs: 480_000, // avg = 60000 => 1m 00s
        decisionTimeCount: 8,
      });

      const populatedStatsRes = await app.request('/duel-001/stats');
      const populatedStats = await populatedStatsRes.json();

      const archiveRes = await app.request('/?sort=recent');
      const archive = await archiveRes.json();

      const checks = {
        emptyStatsStatus200: emptyStatsRes.status === 200,
        emptyGlobalVotesZero: emptyStats.globalStats?.totalVotes === 0,
        emptyTopicVotesZero: emptyStats.topicStats?.totalVotes === 0,
        emptyGlobalAvgNull: emptyStats.globalStats?.avgDecisionTimeMs === null,
        emptyTopicAvgNull: emptyStats.topicStats?.avgDecisionTimeMs === null,
        emptyTopicMetaStable:
          emptyStats.topicStats?.topicMeta?.id === 'topic-nature' &&
          emptyStats.topicStats?.topicMeta?.label === 'Nature',
        emptyStatsNoAvgReadingTime: !Object.prototype.hasOwnProperty.call(emptyStats, 'avgReadingTime'),

        populatedStatsStatus200: populatedStatsRes.status === 200,
        populatedGlobalVotes: populatedStats.globalStats?.totalVotes === 12,
        populatedGlobalRate: populatedStats.globalStats?.humanWinRate === 75,
        populatedGlobalAvgMs: populatedStats.globalStats?.avgDecisionTimeMs === 120000,
        populatedGlobalAvgFmt: populatedStats.globalStats?.avgDecisionTime === '2m 00s',
        populatedTopicVotes: populatedStats.topicStats?.totalVotes === 8,
        populatedTopicRate: populatedStats.topicStats?.humanWinRate === 75,
        populatedTopicAvgMs: populatedStats.topicStats?.avgDecisionTimeMs === 60000,
        populatedTopicAvgFmt: populatedStats.topicStats?.avgDecisionTime === '1m 00s',

        archiveStatus200: archiveRes.status === 200,
        archiveHasRow: Array.isArray(archive) && archive.length === 1,
        archiveAvgMs: archive[0]?.avgDecisionTimeMs === 60000,
        archiveAvgFmt: archive[0]?.avgDecisionTime === '1m 00s',
        archiveNoAvgReadingTime: !Object.prototype.hasOwnProperty.call(archive[0] ?? {}, 'avgReadingTime'),
      };

      const allPassed = Object.values(checks).every(Boolean);
      console.log(JSON.stringify({ allPassed, checks }));
    } catch (error) {
      console.error(
        JSON.stringify({
          allPassed: false,
          checks: {},
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exit(1);
    } finally {
      await db.$client.close();
    }
  `;
}

try {
  TestLogger.info('=== Starting Manual Test: User Analytics Phase 3 ===', { testRunId, logFile });

  TestLogger.startPhase('Setup');

  const requiredFiles = [
    'apps/api/src/routes/duels.ts',
    'apps/api/src/routes/duels.test.ts',
    'apps/web/lib/api.ts',
    'apps/web/lib/api.test.ts',
    'packages/shared/src/index.ts',
    'conductor/tracks/user_analytics_20260312/plan.md',
    'conductor/tracks/user_analytics_20260312/spec.md',
  ];

  for (const relPath of requiredFiles) {
    requireTrue(existsSync(path.join(repoRoot, relPath)), `Required file exists: ${relPath}`);
  }

  mkdirSync(tempDbDir, { recursive: true });
  tracker.track('Temporary sqlite database', [tempDbFile, tempDbWal, tempDbShm], async () => {
    for (const file of [tempDbWal, tempDbShm, tempDbFile]) {
      if (existsSync(file)) rmSync(file, { force: true });
    }
  });

  const dbPushResult = await runCommand(['pnpm', '--filter', '@sanctuary/api', 'db:push'], {
    env: {
      CI: 'true',
      LIBSQL_URL: tempDbUrl,
      LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
    },
  });
  TestLogger.info('db:push command completed', {
    exitCode: dbPushResult.exitCode,
    stdoutTail: dbPushResult.stdout.trim().slice(-800),
    stderrTail: dbPushResult.stderr.trim().slice(-500),
  });
  requireTrue(dbPushResult.exitCode === 0, 'db:push succeeds for isolated manual-test database');

  TestLogger.endPhase('Setup');

  TestLogger.startPhase('Contract/source checks');

  const duelsRouteSource = readFileSync(
    path.join(repoRoot, 'apps/api/src/routes/duels.ts'),
    'utf8',
  );
  requireTrue(
    duelsRouteSource.includes('globalStats: {') && duelsRouteSource.includes('topicStats: {'),
    'GET /duels/:id/stats builds globalStats and topicStats payload sections',
  );
  requireTrue(
    !duelsRouteSource.includes('avgReadingTime'),
    'duels route source no longer references avgReadingTime',
  );

  const sharedSource = readFileSync(path.join(repoRoot, 'packages/shared/src/index.ts'), 'utf8');
  requireTrue(
    sharedSource.includes('export interface GlobalStats'),
    'Shared contract exports GlobalStats',
  );
  requireTrue(
    sharedSource.includes('export interface TopicStats'),
    'Shared contract exports TopicStats',
  );
  requireTrue(
    sharedSource.includes('avgDecisionTimeMs: number | null;') &&
      sharedSource.includes('avgDecisionTime: string | null;'),
    'Shared contract uses avgDecisionTime fields',
  );
  requireTrue(
    !sharedSource.includes('avgReadingTime'),
    'Shared contract has no avgReadingTime field',
  );

  const webApiSource = readFileSync(path.join(repoRoot, 'apps/web/lib/api.ts'), 'utf8');
  requireTrue(
    webApiSource.includes('getDuelStats(id: string): Promise<DuelStatsResponse>'),
    'Web API client exposes DuelStatsResponse for /duels/:id/stats',
  );

  TestLogger.endPhase('Contract/source checks');

  TestLogger.startPhase('Route behavior checks');

  const routeIntegrationScriptPath = path.join(
    repoRoot,
    'apps/api',
    `.tmp-${testRunId}-route-check.ts`,
  );
  writeFileSync(routeIntegrationScriptPath, buildRouteIntegrationScript(), 'utf8');
  tracker.track('Temporary route integration script', [routeIntegrationScriptPath], async () => {
    if (existsSync(routeIntegrationScriptPath)) rmSync(routeIntegrationScriptPath, { force: true });
  });

  const routeCheckResult = await runCommand(['bun', routeIntegrationScriptPath], {
    cwd: path.join(repoRoot, 'apps/api'),
    env: {
      LIBSQL_URL: tempDbUrl,
      LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
    },
  });
  TestLogger.info('Route integration check command completed', {
    exitCode: routeCheckResult.exitCode,
    stdoutTail: routeCheckResult.stdout.trim().slice(-1200),
    stderrTail: routeCheckResult.stderr.trim().slice(-500),
  });
  requireEquals(0, routeCheckResult.exitCode, 'Route integration check command exits successfully');

  const routeCheck = parseJsonLine<{ allPassed: boolean; checks: Record<string, boolean> }>(
    routeCheckResult.stdout,
  );
  requireTrue(routeCheck.allPassed, 'Route integration checks pass');
  for (const [checkName, passed] of Object.entries(routeCheck.checks)) {
    requireTrue(passed, `Route check: ${checkName}`);
  }

  TestLogger.endPhase('Route behavior checks');

  TestLogger.startPhase('Automated tests');

  const apiRouteTests = await runCommand(
    ['pnpm', '--filter', '@sanctuary/api', 'test', 'src/routes/duels.test.ts'],
    { env: { CI: 'true' } },
  );
  TestLogger.info('API duels route tests completed', {
    exitCode: apiRouteTests.exitCode,
    stdoutTail: apiRouteTests.stdout.trim().slice(-1000),
    stderrTail: apiRouteTests.stderr.trim().slice(-500),
  });
  requireEquals(0, apiRouteTests.exitCode, 'API route tests pass for duels verdict payload');

  const webApiTests = await runCommand(
    ['pnpm', '--filter', '@sanctuary/web', 'test', 'lib/api.test.ts'],
    { env: { CI: 'true' } },
  );
  TestLogger.info('Web API client tests completed', {
    exitCode: webApiTests.exitCode,
    stdoutTail: webApiTests.stdout.trim().slice(-1000),
    stderrTail: webApiTests.stderr.trim().slice(-500),
  });
  requireEquals(0, webApiTests.exitCode, 'Web API client tests pass for stats data fetching');

  TestLogger.endPhase('Automated tests');

  allPassed = TestAssertion.summary();
  if (!allPassed) {
    throw new Error('One or more Phase 3 verification assertions failed.');
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
