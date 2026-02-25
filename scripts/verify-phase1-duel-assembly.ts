#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 1: Database Schema Updates
 * Generated: 2026-02-25
 * Purpose: Verify featured_duels schema, migration, and cardinality behavior
 *          for Phase 5 - Duel Assembly & API Updates
 *
 * Run with: bun scripts/verify-phase1-duel-assembly.ts
 */

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { featuredDuels } from '../packages/db/src/schema';

type CheckFn = () => void | Promise<void>;

const testRunId = `phase1_duel_assembly_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logDir = path.join(repoRoot, 'logs', 'manual_tests');
const logFile = path.join(logDir, `${testRunId}.log`);
const tmpDir = process.env.TMPDIR ?? '/tmp';
const dbWorkDir = path.join(tmpDir, 'sanctuary_manual_tests');
const dbFile = path.join(dbWorkDir, `${testRunId}.sqlite`);
const dbUrl = process.env.LIBSQL_MANUAL_TEST_URL ?? `file:${dbFile}`;

mkdirSync(logDir, { recursive: true });
writeFileSync(logFile, '');

let db: ReturnType<typeof createDb> | null = null;
type LibsqlTx = {
  execute: (stmt: unknown) => Promise<{ rows: Array<Array<unknown>> }>;
  rollback?: () => Promise<void>;
  close?: () => Promise<void>;
};
let tx: LibsqlTx | null = null;
let cleanupLocalDbFile: string | null = null;

function log(level: 'INFO' | 'ERROR', message: string, context?: Record<string, unknown>): void {
  const payload = context ? ` ${JSON.stringify(context)}` : '';
  const line = `[${new Date().toISOString()}] [${level}] ${message}${payload}`;
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
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

  return {
    exitCode: proc.exitCode ?? 1,
    stdout,
    stderr,
  };
}

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  log('INFO', `Starting check: ${name}`);

  try {
    await fn();
    log('INFO', `PASS: ${name}`);
    return true;
  } catch (error) {
    log('ERROR', `FAIL: ${name}`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function main(): Promise<void> {
  log('INFO', '=== Starting Manual Test: Phase 1 Database Schema Updates ===', {
    testRunId,
  });

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Manual verification is blocked when NODE_ENV=production.');
  }

  let passed = 0;
  let failed = 0;

  // ===== SETUP =====

  const setupPassed = await runCheck('Setup: required Phase 1 files exist', async () => {
    const requiredFiles = [
      path.join(repoRoot, 'packages/db/src/schema.ts'),
      path.join(repoRoot, 'packages/db/src/schema.test.ts'),
      path.join(repoRoot, 'docs/backend/featured-duels-schema.md'),
    ];

    for (const file of requiredFiles) {
      assertTrue(existsSync(file), `Missing required file: ${file}`);
    }
  });
  if (setupPassed) {
    passed++;
  } else {
    failed++;
  }

  // ===== EXECUTION =====

  const exportPassed = await runCheck(
    'Execution: featuredDuels is exported from packages/db/src/schema.ts',
    async () => {
      assertTrue(
        featuredDuels !== undefined && featuredDuels !== null,
        'Expected featuredDuels to be a defined Drizzle table object.',
      );
      assertTrue(
        typeof featuredDuels === 'object',
        'Expected featuredDuels to be an object (Drizzle table definition).',
      );
    },
  );
  if (exportPassed) {
    passed++;
  } else {
    failed++;
  }

  const testSuitePassed = await runCheck('Execution: @sanctuary/db test suite passes', async () => {
    const command = ['pnpm', '--filter', '@sanctuary/db', 'test'];
    log('INFO', 'Running command', { command: command.join(' ') });

    const result = await runCommand(command, {
      env: { CI: 'true' },
    });

    log('INFO', 'Command finished', { exitCode: result.exitCode });

    if (result.stdout.trim()) {
      log('INFO', 'Command stdout', { output: result.stdout.trim() });
    }
    if (result.stderr.trim()) {
      log('INFO', 'Command stderr', { output: result.stderr.trim() });
    }

    assertTrue(
      result.exitCode === 0,
      `@sanctuary/db test command failed with exit code ${result.exitCode}`,
    );
  });
  if (testSuitePassed) {
    passed++;
  } else {
    failed++;
  }

  const dbSetupPassed = await runCheck(
    'Execution: create isolated manual-test database',
    async () => {
      mkdirSync(dbWorkDir, { recursive: true });

      if (!process.env.LIBSQL_MANUAL_TEST_URL) {
        log('INFO', 'Preparing local file-backed LibSQL database', { dbUrl, dbFile });
        cleanupLocalDbFile = dbFile;

        const command = ['pnpm', '--filter', '@sanctuary/api', 'db:push'];
        log('INFO', 'Running command', { command: command.join(' '), dbUrl });

        const result = await runCommand(command, {
          env: {
            CI: 'true',
            LIBSQL_URL: dbUrl,
            LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
          },
        });

        log('INFO', 'Command finished', { exitCode: result.exitCode });

        if (result.stdout.trim()) {
          log('INFO', 'Command stdout', { output: result.stdout.trim() });
        }
        if (result.stderr.trim()) {
          log('INFO', 'Command stderr', { output: result.stderr.trim() });
        }

        assertTrue(result.exitCode === 0, `db:push failed with exit code ${result.exitCode}`);
      } else {
        log('INFO', 'Using external manual-test LibSQL database', { dbUrl });
        log('INFO', 'Skipping db:push because LIBSQL_MANUAL_TEST_URL is set.');
      }

      db = createDb({
        url: dbUrl,
        authToken: process.env.LIBSQL_AUTH_TOKEN,
      });
      log('INFO', 'Drizzle client created', { dbUrl });

      // Strongest guarantee: all writes occur in a single transaction that is rolled back.
      tx = (await db.$client.transaction('write')) as LibsqlTx;
      log('INFO', 'Write transaction started (rollback-only)');
    },
  );
  if (dbSetupPassed) {
    passed++;
  } else {
    failed++;
  }

  const tableExistsPassed = await runCheck(
    'Execution: featured_duels table exists in manual-test database',
    async () => {
      assertTrue(tx !== null, 'Database transaction was not initialized — skipping.');

      const result = await tx!.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='featured_duels'",
      );

      assertTrue(
        result.rows.length === 1,
        `Expected featured_duels in sqlite_master, got ${result.rows.length} row(s).`,
      );

      log('INFO', 'featured_duels table confirmed in sqlite_master');
    },
  );
  if (tableExistsPassed) {
    passed++;
  } else {
    failed++;
  }

  // Shared state between the insert and retrieve checks (no cleanup needed: transaction is rolled back)
  const insertedIds: number[] = [];
  let duelId: string | null = null;
  let featuredOn: string | null = null;

  const insertsPassed = await runCheck(
    'Execution: same-day same-duel duplicate inserts both succeed',
    async () => {
      assertTrue(tx !== null, 'Database transaction was not initialized — skipping.');

      const today = new Date().toISOString().slice(0, 10);
      const testTopicId = `manual_test_topic_${testRunId}`;
      const poemAId = `manual_test_poem_a_${testRunId}`;
      const poemBId = `manual_test_poem_b_${testRunId}`;
      const testDuelId = `manual_test_duel_${testRunId}`;

      await tx!.execute({
        sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
        args: [testTopicId, 'Manual test topic'],
      });

      await tx!.execute({
        sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
        args: [poemAId, 'Manual Test Poem A', 'Content A', 'Codex', 'HUMAN'],
      });
      await tx!.execute({
        sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
        args: [poemBId, 'Manual Test Poem B', 'Content B', 'Codex', 'HUMAN'],
      });

      await tx!.execute({
        sql: 'INSERT INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)',
        args: [testDuelId, 'Manual test duel topic', testTopicId, poemAId, poemBId],
      });

      duelId = testDuelId;
      featuredOn = today;

      log('INFO', 'Seeded FK rows for featured_duels insert test', { duelId, featuredOn });

      const insert1 = await tx!.execute({
        sql: 'INSERT INTO featured_duels (duel_id, featured_on) VALUES (?, ?) RETURNING id',
        args: [duelId, featuredOn],
      });
      assertTrue(insert1.rows.length === 1, 'Expected INSERT 1 to return exactly one id.');
      const id1 = Number(insert1.rows[0][0]);
      assertTrue(Number.isFinite(id1), 'Expected INSERT 1 to return a numeric id.');
      log('INFO', 'Insert 1 (same day, same duel): succeeded', { id: id1 });

      const insert2 = await tx!.execute({
        sql: 'INSERT INTO featured_duels (duel_id, featured_on) VALUES (?, ?) RETURNING id',
        args: [duelId, featuredOn],
      });
      assertTrue(insert2.rows.length === 1, 'Expected INSERT 2 to return exactly one id.');
      const id2 = Number(insert2.rows[0][0]);
      assertTrue(Number.isFinite(id2), 'Expected INSERT 2 to return a numeric id.');
      log('INFO', 'Insert 2 (same day, same duel again): succeeded', { id: id2 });

      insertedIds.push(id1, id2);

      log('INFO', 'Captured inserted row IDs', { ids: insertedIds });
    },
  );
  if (insertsPassed) {
    passed++;
  } else {
    failed++;
  }

  const retrievePassed = await runCheck(
    'Execution: both inserted rows are retrievable via SELECT',
    async () => {
      assertTrue(tx !== null, 'Database transaction was not initialized — skipping.');
      assertTrue(
        insertedIds.length === 2,
        `Expected 2 tracked inserted IDs from previous check, got ${insertedIds.length}.`,
      );
      assertTrue(duelId !== null, 'Expected duelId to be set by insert check.');
      assertTrue(featuredOn !== null, 'Expected featuredOn to be set by insert check.');

      const rows = await tx!.execute({
        sql: 'SELECT id, duel_id, featured_on FROM featured_duels WHERE duel_id = ? AND featured_on = ? ORDER BY id DESC',
        args: [duelId, featuredOn],
      });

      const retrievedIds = rows.rows.map((r) => Number(r[0]));
      for (const id of insertedIds) {
        assertTrue(
          retrievedIds.includes(id),
          `Expected row with id=${id} to be retrievable but it was not found.`,
        );
      }

      log('INFO', 'Both rows retrieved successfully', {
        insertedIds,
        duelId,
        featuredOn,
        rowCount: rows.rows.length,
      });
    },
  );
  if (retrievePassed) {
    passed++;
  } else {
    failed++;
  }

  log('INFO', '=== Manual Test Run Completed ===', {
    passedChecks: passed,
    failedChecks: failed,
    logFile,
    dbUrl,
    dbFile: process.env.LIBSQL_MANUAL_TEST_URL ? '(external)' : dbFile,
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    log('ERROR', 'Fatal error in Phase 1 manual verification script', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  }
})().finally(async () => {
  // Ensure sockets/resources are closed and the process can exit cleanly.
  // This is especially important for `libsql://`/Turso transports.
  try {
    if (tx?.rollback) {
      await tx.rollback();
      log('INFO', 'Rolled back manual-test transaction (no DB writes persisted)');
    } else if (tx?.close) {
      await tx.close();
      log('INFO', 'Closed manual-test transaction (rollback-only semantics expected)');
    }
  } catch (error) {
    log('ERROR', 'Failed to rollback manual-test transaction', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (db) {
      await db.$client.close();
      log('INFO', 'Closed LibSQL client');
    }
  } catch (error) {
    log('ERROR', 'Failed to close LibSQL client', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (process.env.LIBSQL_MANUAL_TEST_URL) {
      log('INFO', 'External manual-test database was used; no local file cleanup performed.');
      return;
    }

    if (!cleanupLocalDbFile) {
      return;
    }

    if (process.env.MANUAL_TEST_KEEP_DB === '1') {
      log('INFO', 'Keeping local manual-test database file (MANUAL_TEST_KEEP_DB=1)', {
        dbFile: cleanupLocalDbFile,
      });
      return;
    }

    rmSync(cleanupLocalDbFile, { force: true });
    log('INFO', 'Removed local manual-test database file', { dbFile: cleanupLocalDbFile });
  } catch (error) {
    log('ERROR', 'Failed to remove local manual-test database file', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
