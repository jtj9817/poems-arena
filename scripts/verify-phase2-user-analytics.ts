#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 2: Core Voting & Aggregation Logic
 * Generated: 2026-03-13
 * Purpose: Verify vote payload validation, readingTime clamping, and aggregate updates
 *
 * Run with: bun scripts/verify-phase2-user-analytics.ts
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DataTracker, TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface RouterCheckResult {
  allPassed: boolean;
  checks: Record<string, boolean>;
}

const testRunId = `phase2_user_analytics_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
let allPassed: boolean;

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

  throw new Error('Unable to parse JSON result from router integration command output.');
}

function buildRouterIntegrationScript(): string {
  return String.raw`
    import { Hono } from 'hono';
    import { createDb } from '../../packages/db/src/client';
    import {
      duels,
      globalStatistics,
      poems,
      topicStatistics,
      topics,
      votes,
    } from '../../packages/db/src/schema';
    import { createVotesRouter } from './src/routes/votes';

    const MAX_READING_TIME_MS = 10 * 60 * 1000;
    const db = createDb({
      url: process.env.LIBSQL_URL,
      authToken: process.env.LIBSQL_AUTH_TOKEN,
    });

    async function postVote(app, body) {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      return { status: res.status, data };
    }

    try {
      await db.insert(topics).values([
        { id: 'topic-nature', label: 'Nature' },
        { id: 'topic-love', label: 'Love' },
      ]);

      await db.insert(poems).values([
        {
          id: 'poem-human-1',
          title: 'Leaf and River',
          content: 'line 1',
          author: 'Manual Tester',
          type: 'HUMAN',
        },
        {
          id: 'poem-ai-1',
          title: 'Autumn Echo',
          content: 'line 2',
          author: 'Manual Tester',
          type: 'AI',
        },
        {
          id: 'poem-human-2',
          title: 'Hearts in Winter',
          content: 'line 3',
          author: 'Manual Tester',
          type: 'HUMAN',
        },
        {
          id: 'poem-ai-2',
          title: 'Binary Sonnet',
          content: 'line 4',
          author: 'Manual Tester',
          type: 'AI',
        },
        {
          id: 'poem-other',
          title: 'Unrelated Poem',
          content: 'line 5',
          author: 'Manual Tester',
          type: 'HUMAN',
        },
      ]);

      await db.insert(duels).values([
        {
          id: 'duel-001',
          topic: 'Nature',
          topicId: 'topic-nature',
          poemAId: 'poem-human-1',
          poemBId: 'poem-ai-1',
        },
        {
          id: 'duel-002',
          topic: 'Love',
          topicId: 'topic-love',
          poemAId: 'poem-human-2',
          poemBId: 'poem-ai-2',
        },
      ]);

      const app = new Hono();
      app.route('/', createVotesRouter(db));

      const missingReadingTime = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
      });
      const zeroReadingTime = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 0,
      });
      const negativeReadingTime = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: -5,
      });
      const wrongPoem = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-other',
        readingTimeMs: 1000,
      });

      const rowsAfterInvalidVotes = await db.select().from(votes);
      const globalAfterInvalidVotes = await db.select().from(globalStatistics);
      const topicAfterInvalidVotes = await db.select().from(topicStatistics);

      const humanVote = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-human-1',
        readingTimeMs: 30000,
      });

      const votesAfterFirst = await db.select().from(votes);
      const globalAfterFirst = await db.select().from(globalStatistics);
      const topicAfterFirst = await db.select().from(topicStatistics);

      const aiVote = await postVote(app, {
        duelId: 'duel-001',
        selectedPoemId: 'poem-ai-1',
        readingTimeMs: 20000,
      });

      const globalAfterSecond = await db.select().from(globalStatistics);
      const topicRowsAfterSecond = await db.select().from(topicStatistics);
      const natureAfterSecond = topicRowsAfterSecond.filter((row) => row.topicId === 'topic-nature');

      const oversizedVote = await postVote(app, {
        duelId: 'duel-002',
        selectedPoemId: 'poem-ai-2',
        readingTimeMs: 900000,
      });

      const votesAfterThird = await db.select().from(votes);
      const latestVote = votesAfterThird[votesAfterThird.length - 1];
      const globalAfterThird = await db.select().from(globalStatistics);
      const allTopicRows = await db.select().from(topicStatistics);
      const natureTopic = allTopicRows.find((row) => row.topicId === 'topic-nature');
      const loveTopic = allTopicRows.find((row) => row.topicId === 'topic-love');

      const checks = {
        missingReadingTimeRejected: missingReadingTime.status === 400,
        zeroReadingTimeRejected: zeroReadingTime.status === 400,
        negativeReadingTimeRejected: negativeReadingTime.status === 400,
        wrongPoemRejected: wrongPoem.status === 400,
        invalidVotesInsertNothing: rowsAfterInvalidVotes.length === 0,
        invalidVotesNoGlobalStats: globalAfterInvalidVotes.length === 0,
        invalidVotesNoTopicStats: topicAfterInvalidVotes.length === 0,

        humanVoteSucceeds: humanVote.status === 200,
        humanVoteReturnsSuccess: humanVote.data?.success === true,
        humanVoteReturnsIsHumanTrue: humanVote.data?.isHuman === true,
        firstVotePersisted: votesAfterFirst.length === 1,
        firstVoteReadingTimeExact: votesAfterFirst[0]?.readingTimeMs === 30000,
        globalCreated: globalAfterFirst.length === 1,
        globalAfterFirstCounts:
          globalAfterFirst[0]?.id === 'global' &&
          globalAfterFirst[0]?.totalVotes === 1 &&
          globalAfterFirst[0]?.humanVotes === 1 &&
          globalAfterFirst[0]?.decisionTimeSumMs === 30000 &&
          globalAfterFirst[0]?.decisionTimeCount === 1,
        topicAfterFirstCounts:
          topicAfterFirst.length === 1 &&
          topicAfterFirst[0]?.topicId === 'topic-nature' &&
          topicAfterFirst[0]?.topicLabel === 'Nature' &&
          topicAfterFirst[0]?.totalVotes === 1 &&
          topicAfterFirst[0]?.humanVotes === 1 &&
          topicAfterFirst[0]?.decisionTimeSumMs === 30000 &&
          topicAfterFirst[0]?.decisionTimeCount === 1,

        aiVoteSucceeds: aiVote.status === 200,
        aiVoteReturnsSuccess: aiVote.data?.success === true,
        aiVoteReturnsIsHumanFalse: aiVote.data?.isHuman === false,
        globalAfterSecondCounts:
          globalAfterSecond[0]?.totalVotes === 2 &&
          globalAfterSecond[0]?.humanVotes === 1 &&
          globalAfterSecond[0]?.decisionTimeSumMs === 50000 &&
          globalAfterSecond[0]?.decisionTimeCount === 2,
        natureAfterSecondCounts:
          natureAfterSecond.length === 1 &&
          natureAfterSecond[0]?.totalVotes === 2 &&
          natureAfterSecond[0]?.humanVotes === 1 &&
          natureAfterSecond[0]?.decisionTimeSumMs === 50000 &&
          natureAfterSecond[0]?.decisionTimeCount === 2,

        oversizedVoteSucceeds: oversizedVote.status === 200,
        totalValidVotesPersisted: votesAfterThird.length === 3,
        oversizedVoteClampedInVoteRow: latestVote?.readingTimeMs === MAX_READING_TIME_MS,
        globalAfterThirdCounts:
          globalAfterThird[0]?.totalVotes === 3 &&
          globalAfterThird[0]?.humanVotes === 1 &&
          globalAfterThird[0]?.decisionTimeSumMs === 650000 &&
          globalAfterThird[0]?.decisionTimeCount === 3,
        twoTopicRowsExist: allTopicRows.length === 2,
        natureTopicStable:
          !!natureTopic &&
          natureTopic.totalVotes === 2 &&
          natureTopic.humanVotes === 1 &&
          natureTopic.decisionTimeSumMs === 50000 &&
          natureTopic.decisionTimeCount === 2,
        loveTopicCreatedWithClamp:
          !!loveTopic &&
          loveTopic.topicLabel === 'Love' &&
          loveTopic.totalVotes === 1 &&
          loveTopic.humanVotes === 0 &&
          loveTopic.decisionTimeSumMs === MAX_READING_TIME_MS &&
          loveTopic.decisionTimeCount === 1,
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
  TestLogger.info('=== Starting Manual Test: User Analytics Phase 2 ===', { testRunId, logFile });

  TestLogger.startPhase('Setup');

  const requiredFiles = [
    'apps/api/src/routes/votes.ts',
    'apps/api/src/routes/votes.test.ts',
    'apps/api/src/index.ts',
    'conductor/tracks/user_analytics_20260312/plan.md',
    'conductor/tracks/user_analytics_20260312/spec.md',
  ];

  for (const relPath of requiredFiles) {
    const absPath = path.join(repoRoot, relPath);
    requireTrue(existsSync(absPath), `Required file exists: ${relPath}`);
  }

  const votesRouteSource = await Bun.file(
    path.join(repoRoot, 'apps/api/src/routes/votes.ts'),
  ).text();
  const apiIndexSource = await Bun.file(path.join(repoRoot, 'apps/api/src/index.ts')).text();

  requireTrue(
    /export\s+function\s+createVotesRouter\s*\(\s*db\s*:\s*Db\s*\)/.test(votesRouteSource),
    'votes router exports createVotesRouter(db) factory',
  );
  requireTrue(
    /readingTimeMs:\s*z\.number\(\)\.int\(\)\.positive\(\)/.test(votesRouteSource),
    'vote schema requires positive integer readingTimeMs',
  );
  requireTrue(
    /Math\.min\(rawReadingTimeMs,\s*MAX_READING_TIME_MS\)/.test(votesRouteSource),
    'votes router clamps readingTimeMs to MAX_READING_TIME_MS',
  );
  requireTrue(
    /await\s+db\.batch\(\[/.test(votesRouteSource),
    'votes route uses db.batch for atomic vote + aggregate writes',
  );
  requireTrue(
    /app\.route\('\/api\/v1\/votes',\s*createVotesRouter\(db\)\)/.test(apiIndexSource),
    'API index wires /api/v1/votes with createVotesRouter(db)',
  );

  const tempDir = await mkdtemp(path.join(tmpdir(), 'sanctuary-manual-phase2-'));
  const dbFile = path.join(tempDir, 'phase2.sqlite');
  const dbUrl = `file:${dbFile}`;

  tracker.track('Temporary phase2 test database', [tempDir], async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const dbPushResult = await runCommand(['pnpm', '--filter', '@sanctuary/api', 'db:push'], {
    env: {
      CI: 'true',
      LIBSQL_URL: dbUrl,
      LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
    },
  });
  TestLogger.info('db:push command completed', {
    exitCode: dbPushResult.exitCode,
    stdoutTail: dbPushResult.stdout.trim().slice(-800),
    stderrTail: dbPushResult.stderr.trim().slice(-500),
  });
  requireEquals(
    0,
    dbPushResult.exitCode,
    'db:push succeeds for isolated phase2 manual-test database',
  );

  TestLogger.endPhase('Setup');

  TestLogger.startPhase('Route integration verification (in-process Hono app)');

  const integrationScript = buildRouterIntegrationScript();
  const integrationCommand = [
    'pnpm',
    '--filter',
    '@sanctuary/api',
    'exec',
    'bun',
    '-e',
    integrationScript,
  ];

  const integrationResult = await runCommand(integrationCommand, {
    env: {
      CI: 'true',
      LIBSQL_URL: dbUrl,
      LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
    },
  });
  TestLogger.info('Route integration command completed', {
    exitCode: integrationResult.exitCode,
    stdoutTail: integrationResult.stdout.trim().slice(-1200),
    stderrTail: integrationResult.stderr.trim().slice(-800),
  });
  requireEquals(0, integrationResult.exitCode, 'Route integration command exits with code 0');

  const integrationPayload = parseJsonLine<RouterCheckResult>(integrationResult.stdout);
  requireTrue(
    integrationPayload.allPassed === true,
    'All in-process route integration checks pass',
  );

  for (const [checkName, passed] of Object.entries(integrationPayload.checks)) {
    requireTrue(passed === true, `Router integration check passes: ${checkName}`);
  }

  TestLogger.endPhase('Route integration verification (in-process Hono app)');

  TestLogger.startPhase('Automated route test gate');
  const testCommand = ['pnpm', '--filter', '@sanctuary/api', 'test', 'src/routes/votes.test.ts'];
  TestLogger.info('Running automated verification command', {
    command: testCommand.join(' '),
  });
  const apiTestResult = await runCommand(testCommand, { env: { CI: 'true' } });
  TestLogger.info('Automated test command completed', {
    exitCode: apiTestResult.exitCode,
    stdoutTail: apiTestResult.stdout.trim().slice(-1200),
    stderrTail: apiTestResult.stderr.trim().slice(-500),
  });
  requireEquals(0, apiTestResult.exitCode, 'votes route automated tests pass');
  TestLogger.endPhase('Automated route test gate');
} catch (error) {
  TestAssertion.assertTrue(false, 'Phase 2 manual verification completed without fatal errors');
  TestLogger.error('Fatal error in Phase 2 manual verification', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 900) : undefined,
  });
} finally {
  allPassed = TestAssertion.summary();
  await tracker.cleanup();
  TestLogger.info('=== Manual Test Run Completed ===', { allPassed });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Test ID : ${testRunId}`);
  console.log(`  Result  : ${allPassed ? '✓ PASSED' : '✗ FAILED'}`);
  console.log(`  Logs    : ${logFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exitCode = allPassed ? 0 : 1;
}
