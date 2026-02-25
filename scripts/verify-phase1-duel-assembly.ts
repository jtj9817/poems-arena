#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 1: Database Schema Updates
 * Generated: 2026-02-25
 * Purpose: Verify featured_duels schema, migration, and cardinality behavior
 *          for Phase 5 - Duel Assembly & API Updates
 *
 * Run with: bun scripts/verify-phase1-duel-assembly.ts
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createDb } from '../packages/db/src/client';
import { resolveDbConfig } from '../packages/db/src/config';
import { featuredDuels } from '../packages/db/src/schema';

type CheckFn = () => void | Promise<void>;

const testRunId = `phase1_duel_assembly_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logDir = path.join(repoRoot, 'logs', 'manual_tests');
const logFile = path.join(logDir, `${testRunId}.log`);

mkdirSync(logDir, { recursive: true });
writeFileSync(logFile, '');

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

  // Build the Drizzle client once for all live DB checks.
  // db.$client gives access to the underlying LibSQL client for raw SQL execution.
  let db: ReturnType<typeof createDb> | null = null;
  const dbSetupPassed = await runCheck('Execution: connect to Turso database', async () => {
    assertTrue(
      typeof process.env.LIBSQL_URL === 'string' && process.env.LIBSQL_URL.length > 0,
      'LIBSQL_URL env var is required for live database checks.',
    );
    db = createDb(resolveDbConfig(process.env));
    log('INFO', 'Drizzle client created', { url: process.env.LIBSQL_URL });
  });
  if (dbSetupPassed) {
    passed++;
  } else {
    failed++;
  }

  const tableExistsPassed = await runCheck(
    'Execution: featured_duels table exists in Turso database',
    async () => {
      assertTrue(db !== null, 'Database client was not initialized — skipping.');

      const result = await db!.$client.execute(
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

  // Shared state between the insert, retrieve, and cleanup checks
  const insertedIds: number[] = [];
  let insertedDuelId: string | null = null;
  let insertedFeaturedOn: string | null = null;

  const insertsPassed = await runCheck(
    'Execution: same-day same-duel duplicate inserts both succeed',
    async () => {
      assertTrue(db !== null, 'Database client was not initialized — skipping.');

      const today = new Date().toISOString().slice(0, 10);

      const duelsResult = await db!.$client.execute('SELECT id FROM duels LIMIT 1');
      assertTrue(
        duelsResult.rows.length > 0,
        'No duel rows found — need at least one existing duel to test the FK constraint.',
      );

      const duelId = duelsResult.rows[0][0] as string;
      log('INFO', 'Resolved test duel_id', { duelId, featuredOn: today });

      await db!.$client.execute({
        sql: 'INSERT INTO featured_duels (duel_id, featured_on) VALUES (?, ?)',
        args: [duelId, today],
      });
      log('INFO', 'Insert 1 (same day, same duel): succeeded');

      await db!.$client.execute({
        sql: 'INSERT INTO featured_duels (duel_id, featured_on) VALUES (?, ?)',
        args: [duelId, today],
      });
      log('INFO', 'Insert 2 (same day, same duel again): succeeded');

      // Capture the two newest rows for this duelId + date for retrieve/cleanup
      const rows = await db!.$client.execute({
        sql: 'SELECT id FROM featured_duels WHERE duel_id = ? AND featured_on = ? ORDER BY id DESC LIMIT 2',
        args: [duelId, today],
      });

      insertedIds.push(...rows.rows.map((r) => Number(r[0])));
      insertedDuelId = duelId;
      insertedFeaturedOn = today;

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
      assertTrue(db !== null, 'Database client was not initialized — skipping.');
      assertTrue(
        insertedIds.length === 2,
        `Expected 2 tracked inserted IDs from previous check, got ${insertedIds.length}.`,
      );

      const rows = await db!.$client.execute({
        sql: 'SELECT id, duel_id, featured_on FROM featured_duels WHERE duel_id = ? AND featured_on = ? ORDER BY id DESC',
        args: [insertedDuelId!, insertedFeaturedOn!],
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
        duelId: insertedDuelId,
        featuredOn: insertedFeaturedOn,
        rowCount: rows.rows.length,
      });
    },
  );
  if (retrievePassed) {
    passed++;
  } else {
    failed++;
  }

  // ===== CLEANUP =====

  const cleanupPassed = await runCheck(
    'Cleanup: delete test rows from featured_duels',
    async () => {
      if (insertedIds.length === 0) {
        log('INFO', 'No test rows to clean up (inserts did not succeed or were skipped).');
        return;
      }

      assertTrue(db !== null, 'Database client was not initialized — skipping cleanup.');

      for (const id of insertedIds) {
        await db!.$client.execute({
          sql: 'DELETE FROM featured_duels WHERE id = ?',
          args: [id],
        });
      }

      log('INFO', 'Test rows deleted from featured_duels', { deletedIds: insertedIds });
    },
  );
  if (cleanupPassed) {
    passed++;
  } else {
    failed++;
  }

  log('INFO', '=== Manual Test Run Completed ===', {
    passedChecks: passed,
    failedChecks: failed,
    logFile,
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  log('ERROR', 'Fatal error in Phase 1 manual verification script', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
