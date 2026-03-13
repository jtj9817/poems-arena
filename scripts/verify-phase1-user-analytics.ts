#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 1: Database & Data Model Updates
 * Generated: 2026-03-13
 * Purpose: Verify User Analytics Phase 1 schema, migration, and DDL updates
 *
 * Run with: bun scripts/verify-phase1-user-analytics.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createDb } from '../packages/db/src/client';
import {
  duels,
  globalStatistics,
  poems,
  topicStatistics,
  topics,
  votes,
} from '../packages/db/src/schema';
import {
  DataTracker,
  RollbackSignal,
  TestAssertion,
  TestEnvironment,
  TestLogger,
} from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const testRunId = `phase1_user_analytics_${new Date().toISOString().replace(/[:.]/g, '_')}`;
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

let db: ReturnType<typeof createDb> | null = null;
let allPassed: boolean;

function rowValue(row: unknown, index: number, key: string): unknown {
  if (Array.isArray(row)) return row[index];
  if (row && typeof row === 'object' && key in row) return (row as Record<string, unknown>)[key];
  return undefined;
}

function findByName(rows: unknown[], name: string): unknown | undefined {
  return rows.find((row) => String(rowValue(row, 1, 'name')) === name);
}

async function runCommand(
  command: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
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

function requireTrue(condition: boolean, message: string): void {
  const ok = TestAssertion.assertTrue(condition, message);
  if (!ok) {
    throw new Error(message);
  }
}

async function queryRows(sqlText: string): Promise<unknown[]> {
  if (!db) throw new Error('Database is not initialized.');
  const result = await db.$client.execute(sqlText);
  return result.rows as unknown[];
}

try {
  TestLogger.info('=== Starting Manual Test: User Analytics Phase 1 ===', { testRunId, logFile });

  TestLogger.startPhase('Setup');

  const requiredFiles = [
    'packages/db/src/schema.ts',
    'apps/api/drizzle/0001_tranquil_gressill.sql',
    'apps/api/src/routes/votes.test.ts',
    'apps/api/src/routes/duels.test.ts',
    'conductor/tracks/user_analytics_20260312/plan.md',
    'conductor/tracks/user_analytics_20260312/spec.md',
  ];

  for (const relPath of requiredFiles) {
    const absPath = path.join(repoRoot, relPath);
    requireTrue(existsSync(absPath), `Required file exists: ${relPath}`);
  }

  const migrationSql = readFileSync(
    path.join(repoRoot, 'apps/api/drizzle/0001_tranquil_gressill.sql'),
    'utf8',
  );
  requireTrue(
    /CREATE TABLE `global_statistics`/i.test(migrationSql),
    'Migration creates global_statistics table',
  );
  requireTrue(
    /CREATE TABLE `topic_statistics`/i.test(migrationSql),
    'Migration creates topic_statistics table',
  );
  requireTrue(
    /ALTER TABLE `votes` ADD `reading_time_ms` integer DEFAULT 0 NOT NULL;/i.test(migrationSql),
    'Migration adds votes.reading_time_ms as NOT NULL',
  );
  requireTrue(
    /CREATE INDEX `votes_duel_id_idx` ON `votes` \(`duel_id`\);/i.test(migrationSql),
    'Migration creates votes_duel_id_idx',
  );
  requireTrue(
    /CREATE INDEX `duels_topic_id_idx` ON `duels` \(`topic_id`\);/i.test(migrationSql),
    'Migration creates duels_topic_id_idx',
  );
  requireTrue(
    /SET `topic_id` = \('topic-' \|\| lower\(replace\(`topic`, ' ', '-'\)\)\)/i.test(migrationSql),
    'Migration backfills duel topic_id values',
  );
  requireTrue(
    /INSERT OR IGNORE INTO `topics` \(`id`, `label`\)/i.test(migrationSql),
    'Migration ensures backfilled topic IDs exist in topics table',
  );

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

  db = createDb({
    url: tempDbUrl,
    authToken: process.env.LIBSQL_AUTH_TOKEN,
  });

  TestLogger.endPhase('Setup');

  TestLogger.startPhase('Schema validation');

  const votesTableInfo = await queryRows("PRAGMA table_info('votes')");
  const readingTimeInfo = findByName(votesTableInfo, 'reading_time_ms');
  requireTrue(readingTimeInfo !== undefined, 'votes.reading_time_ms column exists');
  requireTrue(
    Number(rowValue(readingTimeInfo, 3, 'notnull')) === 1,
    'votes.reading_time_ms is NOT NULL',
  );

  const duelsTableInfo = await queryRows("PRAGMA table_info('duels')");
  const topicIdInfo = findByName(duelsTableInfo, 'topic_id');
  requireTrue(topicIdInfo !== undefined, 'duels.topic_id column exists');
  requireTrue(Number(rowValue(topicIdInfo, 3, 'notnull')) === 1, 'duels.topic_id is NOT NULL');

  const duelsForeignKeys = await queryRows("PRAGMA foreign_key_list('duels')");
  const duelTopicFk = duelsForeignKeys.find(
    (row) =>
      String(rowValue(row, 3, 'from')) === 'topic_id' &&
      String(rowValue(row, 2, 'table')) === 'topics',
  );
  requireTrue(duelTopicFk !== undefined, 'duels.topic_id references topics(id)');

  const topicStatisticsForeignKeys = await queryRows("PRAGMA foreign_key_list('topic_statistics')");
  const topicStatsFk = topicStatisticsForeignKeys.find(
    (row) =>
      String(rowValue(row, 3, 'from')) === 'topic_id' &&
      String(rowValue(row, 2, 'table')) === 'topics',
  );
  requireTrue(topicStatsFk !== undefined, 'topic_statistics.topic_id references topics(id)');

  const tableRows = await queryRows(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('global_statistics', 'topic_statistics') ORDER BY name ASC",
  );
  const tableNames = tableRows.map((row) => String(rowValue(row, 0, 'name'))).sort();
  requireTrue(
    tableNames.join(',') === 'global_statistics,topic_statistics',
    'global_statistics and topic_statistics tables exist',
  );

  const votesIndexes = await queryRows("PRAGMA index_list('votes')");
  const hasVotesDuelIdx = votesIndexes.some(
    (row) => String(rowValue(row, 1, 'name')) === 'votes_duel_id_idx',
  );
  requireTrue(hasVotesDuelIdx, 'votes_duel_id_idx exists');

  const duelsIndexes = await queryRows("PRAGMA index_list('duels')");
  const hasDuelsTopicIdx = duelsIndexes.some(
    (row) => String(rowValue(row, 1, 'name')) === 'duels_topic_id_idx',
  );
  requireTrue(hasDuelsTopicIdx, 'duels_topic_id_idx exists');

  TestLogger.endPhase('Schema validation');

  TestLogger.startPhase('Initialization strategy verification');

  await db.transaction(async (tx) => {
    const [existingGlobal] = await tx.select().from(globalStatistics).limit(1);
    requireTrue(existingGlobal === undefined, 'Fresh DB has no pre-seeded global_statistics rows');

    const [existingTopic] = await tx.select().from(topicStatistics).limit(1);
    requireTrue(existingTopic === undefined, 'Fresh DB has no pre-seeded topic_statistics rows');

    const topicId = `topic-phase1-${testRunId}`;
    const poemAId = `poem-a-${testRunId}`;
    const poemBId = `poem-b-${testRunId}`;
    const duelId = `duel-${testRunId}`;
    const manualGlobalId = `global-${testRunId}`;

    await tx.insert(topics).values({ id: topicId, label: 'Phase 1 Manual Topic' });
    await tx.insert(poems).values([
      {
        id: poemAId,
        title: 'Manual Phase 1 Poem A',
        content: 'Alpha lines',
        author: 'Manual Tester',
        type: 'HUMAN',
      },
      {
        id: poemBId,
        title: 'Manual Phase 1 Poem B',
        content: 'Beta lines',
        author: 'Manual Tester',
        type: 'AI',
      },
    ]);
    await tx.insert(duels).values({
      id: duelId,
      topic: 'Phase 1 Manual Topic',
      topicId,
      poemAId,
      poemBId,
    });
    await tx.insert(votes).values({
      duelId,
      selectedPoemId: poemAId,
      isHuman: true,
      readingTimeMs: 12_345,
    });

    const insertedVotes = await tx
      .select({ duelId: votes.duelId, readingTimeMs: votes.readingTimeMs })
      .from(votes);
    const insertedVote = insertedVotes.find((row) => row.duelId === duelId);
    requireTrue(insertedVote?.readingTimeMs === 12_345, 'votes.readingTimeMs persists correctly');

    await tx.insert(globalStatistics).values({ id: manualGlobalId });
    const globalRows = await tx.select().from(globalStatistics);
    const globalRow = globalRows.find((row) => row.id === manualGlobalId);
    requireTrue(globalRow?.totalVotes === 0, 'global_statistics.totalVotes defaults to 0');
    requireTrue(globalRow?.humanVotes === 0, 'global_statistics.humanVotes defaults to 0');
    requireTrue(
      globalRow?.decisionTimeSumMs === 0,
      'global_statistics.decisionTimeSumMs defaults to 0',
    );
    requireTrue(
      globalRow?.decisionTimeCount === 0,
      'global_statistics.decisionTimeCount defaults to 0',
    );

    await tx.insert(topicStatistics).values({
      topicId,
      topicLabel: 'Phase 1 Manual Topic',
    });
    const topicRows = await tx.select().from(topicStatistics);
    const topicRow = topicRows.find((row) => row.topicId === topicId);
    requireTrue(topicRow?.totalVotes === 0, 'topic_statistics.totalVotes defaults to 0');
    requireTrue(topicRow?.humanVotes === 0, 'topic_statistics.humanVotes defaults to 0');
    requireTrue(
      topicRow?.decisionTimeSumMs === 0,
      'topic_statistics.decisionTimeSumMs defaults to 0',
    );
    requireTrue(
      topicRow?.decisionTimeCount === 0,
      'topic_statistics.decisionTimeCount defaults to 0',
    );
    requireTrue(
      topicRow?.topicLabel === 'Phase 1 Manual Topic',
      'topic_statistics.topicLabel persists denormalized value',
    );

    throw new RollbackSignal();
  });
} catch (error) {
  if (error instanceof RollbackSignal) {
    TestLogger.info('Transaction rolled back cleanly after initialization checks.');

    if (!db) {
      throw new Error('Database was not initialized before rollback verification.', {
        cause: error,
      });
    }

    TestLogger.startPhase('Rollback verification');
    const rollbackTopicId = `topic-phase1-${testRunId}`;
    const rollbackGlobalId = `global-${testRunId}`;

    const rollbackTopics = await db.select().from(topics);
    requireTrue(
      rollbackTopics.every((topicRow) => topicRow.id !== rollbackTopicId),
      'Rollback removed seeded topic row',
    );

    const rollbackTopicStats = await db.select().from(topicStatistics);
    requireTrue(
      rollbackTopicStats.every((topicStatsRow) => topicStatsRow.topicId !== rollbackTopicId),
      'Rollback removed seeded topic_statistics row',
    );

    const rollbackGlobalStats = await db.select().from(globalStatistics);
    requireTrue(
      rollbackGlobalStats.every((globalRow) => globalRow.id !== rollbackGlobalId),
      'Rollback removed seeded global_statistics row',
    );

    const rollbackVotes = await db.select().from(votes);
    requireTrue(rollbackVotes.length === 0, 'Rollback removed seeded vote row');
    TestLogger.endPhase('Rollback verification');

    TestLogger.startPhase('Route test DDL parity checks');
    const votesTestSource = readFileSync(
      path.join(repoRoot, 'apps/api/src/routes/votes.test.ts'),
      'utf8',
    );
    const duelsTestSource = readFileSync(
      path.join(repoRoot, 'apps/api/src/routes/duels.test.ts'),
      'utf8',
    );

    requireTrue(
      /reading_time_ms INTEGER NOT NULL/i.test(votesTestSource),
      'votes.test.ts in-memory DDL includes reading_time_ms NOT NULL',
    );
    requireTrue(
      /CREATE TABLE IF NOT EXISTS global_statistics/i.test(votesTestSource),
      'votes.test.ts in-memory DDL includes global_statistics',
    );
    requireTrue(
      /CREATE TABLE IF NOT EXISTS topic_statistics/i.test(votesTestSource),
      'votes.test.ts in-memory DDL includes topic_statistics',
    );
    requireTrue(
      /topic_id TEXT NOT NULL REFERENCES topics\(id\)/i.test(votesTestSource),
      'votes.test.ts in-memory DDL enforces duels.topic_id NOT NULL',
    );

    requireTrue(
      /reading_time_ms INTEGER NOT NULL/i.test(duelsTestSource),
      'duels.test.ts in-memory DDL includes reading_time_ms NOT NULL',
    );
    requireTrue(
      /CREATE TABLE IF NOT EXISTS global_statistics/i.test(duelsTestSource),
      'duels.test.ts in-memory DDL includes global_statistics',
    );
    requireTrue(
      /CREATE TABLE IF NOT EXISTS topic_statistics/i.test(duelsTestSource),
      'duels.test.ts in-memory DDL includes topic_statistics',
    );
    requireTrue(
      /topic_id TEXT NOT NULL REFERENCES topics\(id\)/i.test(duelsTestSource),
      'duels.test.ts in-memory DDL enforces duels.topic_id NOT NULL',
    );
    TestLogger.endPhase('Route test DDL parity checks');

    TestLogger.startPhase('Automated tests');
    const apiTestResult = await runCommand([
      'pnpm',
      '--filter',
      '@sanctuary/api',
      'test',
      'src/routes/votes.test.ts',
      'src/routes/duels.test.ts',
    ]);
    TestLogger.info('API route test command completed', {
      exitCode: apiTestResult.exitCode,
      stdoutTail: apiTestResult.stdout.trim().slice(-1000),
      stderrTail: apiTestResult.stderr.trim().slice(-500),
    });
    requireTrue(
      apiTestResult.exitCode === 0,
      'Targeted API route tests pass for votes/duels schema behavior',
    );
    TestLogger.endPhase('Automated tests');
  } else {
    TestLogger.error('Fatal error in Phase 1 manual verification', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 900) : undefined,
    });
  }
} finally {
  if (db) {
    await db.$client.close();
  }

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
