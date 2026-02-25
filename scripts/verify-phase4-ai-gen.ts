#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 4: Database Integration and CLI
 * Generated: 2026-02-24
 * Purpose: Verify persistence + CLI orchestration for @sanctuary/ai-gen
 *
 * Run with: bun scripts/verify-phase4-ai-gen.ts
 */

import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import type { CliConfig, ProcessPoemResult } from '../packages/ai-gen/src/cli';
import { parseCliArgs, runGenerationCli } from '../packages/ai-gen/src/cli';
import type { PoemOutput } from '../packages/ai-gen/src/gemini-client';
import {
  buildAiPoemInsertValues,
  fetchUnmatchedHumanPoems,
  persistGeneratedPoem,
  type PersistenceDb,
} from '../packages/ai-gen/src/persistence';
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

interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const testRunId = `phase4_ai_gen_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
let database: Database | null = null;
let tempDbPath: string | null = null;
let allPassed = false;

const PHASE4_IDS = {
  humans: [
    'phase4-human-1',
    'phase4-human-2',
    'phase4-human-3',
    'phase4-human-4',
    'phase4-human-5',
    'phase4-human-6',
  ],
  existingAi: 'ai-phase4-human-2-existing',
  topics: {
    nature: 'phase4-nature',
    modern: 'phase4-modern',
  },
} as const;

async function runCommand(command: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
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

async function runAndAssertCommand(name: string, command: string[]): Promise<void> {
  TestLogger.info(`Running command for ${name}`, {
    command: command.join(' '),
  });
  const result = await runCommand(command, {
    env: { CI: 'true' },
  });

  TestLogger.info(`Command completed for ${name}`, { exitCode: result.exitCode });
  if (result.stdout.trim()) {
    TestLogger.info(`${name} stdout`, { output: result.stdout.trim() });
  }
  if (result.stderr.trim()) {
    TestLogger.warning(`${name} stderr`, { output: result.stderr.trim() });
  }

  if (result.exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${result.exitCode}`);
  }
}

function createPersistenceDb(localDb: Database): PersistenceDb {
  const execute: PersistenceDb['execute'] = async (query: string, params: unknown[] = []) => {
    const sql = query;
    const statement = localDb.query(sql);
    const upper = sql.trimStart().toUpperCase();
    const isReadQuery =
      upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('PRAGMA');

    if (isReadQuery) {
      return {
        rows: statement.all(...params) as Array<Record<string, unknown>>,
      };
    }

    statement.run(...params);
    return { rows: [] as Array<Record<string, unknown>> };
  };

  return {
    execute,
  };
}

function initializeSchema(localDb: Database): void {
  localDb.run('PRAGMA foreign_keys = ON');
  localDb.run(`
    CREATE TABLE poems (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('HUMAN', 'AI')),
      source TEXT,
      prompt TEXT,
      parent_poem_id TEXT REFERENCES poems(id)
    )
  `);
  localDb.run(`
    CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    )
  `);
  localDb.run(`
    CREATE TABLE poem_topics (
      poem_id TEXT NOT NULL REFERENCES poems(id),
      topic_id TEXT NOT NULL REFERENCES topics(id),
      PRIMARY KEY (poem_id, topic_id)
    )
  `);
}

function seedFixtures(localDb: Database): void {
  localDb.run('INSERT INTO topics (id, label) VALUES (?, ?)', [PHASE4_IDS.topics.nature, 'Nature']);
  localDb.run('INSERT INTO topics (id, label) VALUES (?, ?)', [PHASE4_IDS.topics.modern, 'Modern']);

  for (const id of PHASE4_IDS.humans) {
    localDb.run(
      `INSERT INTO poems (id, title, content, author, type, source, prompt, parent_poem_id)
       VALUES (?, ?, ?, ?, 'HUMAN', NULL, NULL, NULL)`,
      [id, `Human ${id}`, 'line 1\nline 2\nline 3\nline 4', 'Human Author'],
    );
  }

  localDb.run(
    `INSERT INTO poems (id, title, content, author, type, source, prompt, parent_poem_id)
     VALUES (?, ?, ?, ?, 'AI', 'ai-generated', 'existing prompt', ?)`,
    [
      PHASE4_IDS.existingAi,
      'Existing Counterpart',
      'line 1\nline 2\nline 3\nline 4',
      'gemini-3-flash-preview',
      'phase4-human-2',
    ],
  );

  for (const naturePoemId of [
    'phase4-human-1',
    'phase4-human-2',
    'phase4-human-4',
    'phase4-human-5',
    'phase4-human-6',
  ]) {
    localDb.run('INSERT INTO poem_topics (poem_id, topic_id) VALUES (?, ?)', [
      naturePoemId,
      PHASE4_IDS.topics.nature,
    ]);
  }
  localDb.run('INSERT INTO poem_topics (poem_id, topic_id) VALUES (?, ?)', [
    'phase4-human-3',
    PHASE4_IDS.topics.modern,
  ]);
}

function countAiRows(localDb: Database, parentPoemId: string): number {
  const row = localDb
    .query(
      `SELECT COUNT(*) AS total
       FROM poems
       WHERE type = 'AI' AND parent_poem_id = ?`,
    )
    .get(parentPoemId) as { total: number };
  return Number(row.total);
}

function generatedPoem(title: string): PoemOutput {
  return {
    title,
    content: 'line one\nline two\nline three\nline four\nline five',
  };
}

async function main(): Promise<void> {
  TestLogger.info('=== Starting Manual Test: Phase 4 Database Integration and CLI ===', {
    testRunId,
    logFile,
  });

  try {
    TestLogger.startPhase('Setup');

    tempDbPath = path.join(
      tmpdir(),
      `classicist-sanctuary-ai-gen-phase4-${Date.now()}-${process.pid}.sqlite`,
    );
    database = new Database(tempDbPath, { create: true });

    initializeSchema(database);
    seedFixtures(database);

    tracker.track(
      'phase4_seed_data',
      [
        ...PHASE4_IDS.humans,
        PHASE4_IDS.existingAi,
        PHASE4_IDS.topics.nature,
        PHASE4_IDS.topics.modern,
      ],
      async () => {
        if (!database) {
          return;
        }

        database.run(`DELETE FROM poem_topics WHERE poem_id LIKE 'phase4-human-%'`);
        database.run(`DELETE FROM poems WHERE id LIKE 'ai-phase4-%' OR id LIKE 'phase4-human-%'`);
        database.run(`DELETE FROM topics WHERE id LIKE 'phase4-%'`);
      },
    );

    TestLogger.endPhase('Setup');

    TestLogger.startPhase('Execution: Phase 4 automated unit tests');
    await runAndAssertCommand('persistence unit tests', [
      'pnpm',
      '--filter',
      '@sanctuary/ai-gen',
      'test',
      '--',
      'src/persistence.test.ts',
    ]);
    await runAndAssertCommand('cli unit tests', [
      'pnpm',
      '--filter',
      '@sanctuary/ai-gen',
      'test',
      '--',
      'src/cli.test.ts',
    ]);
    TestLogger.endPhase('Execution: Phase 4 automated unit tests');

    TestLogger.startPhase('Execution: direct persistence + CLI integration checks');
    const persistenceDb = createPersistenceDb(database);

    const natureLimited = await fetchUnmatchedHumanPoems({
      db: persistenceDb,
      topic: 'nature',
      limit: 3,
    });
    TestAssertion.assertCount(
      3,
      natureLimited,
      'fetchUnmatchedHumanPoems should apply topic filter + limit for unmatched HUMAN poems',
    );
    TestAssertion.assertTrue(
      natureLimited.every((poem) => poem.id !== 'phase4-human-2'),
      'fetchUnmatchedHumanPoems should exclude already matched HUMAN poems',
    );

    const unmatchedAll = await fetchUnmatchedHumanPoems({ db: persistenceDb });
    TestAssertion.assertCount(
      5,
      unmatchedAll,
      'fetchUnmatchedHumanPoems should return all unmatched HUMAN poems by default',
    );

    const parentPoem = unmatchedAll.find((poem) => poem.id === 'phase4-human-1');
    TestAssertion.assertNotNull(
      parentPoem,
      'Seed data should include unmatched parent poem phase4-human-1',
    );
    if (!parentPoem) {
      throw new Error('Unable to continue without phase4-human-1 seed row.');
    }

    const insertValues = buildAiPoemInsertValues({
      parentPoem,
      generatedPoem: generatedPoem('Generated for Persistence'),
      prompt: 'Prompt for phase4-human-1',
      model: 'gemini-3-flash-preview',
    });
    TestAssertion.assertEquals(
      'AI',
      insertValues.type,
      'buildAiPoemInsertValues should set type=AI',
    );
    TestAssertion.assertEquals(
      'gemini-3-flash-preview',
      insertValues.author,
      'buildAiPoemInsertValues should set author=model',
    );
    TestAssertion.assertEquals(
      parentPoem.id,
      insertValues.parentPoemId,
      'buildAiPoemInsertValues should link parent_poem_id',
    );

    const persisted = await persistGeneratedPoem({
      db: persistenceDb,
      parentPoem,
      generatedPoem: generatedPoem('Stored Counterpart'),
      prompt: 'Prompt for phase4-human-1',
      model: 'gemini-3-flash-preview',
    });
    TestAssertion.assertEquals('AI', persisted.type, 'persistGeneratedPoem should store AI row');
    TestAssertion.assertEquals(
      parentPoem.id,
      persisted.parentPoemId ?? '',
      'persistGeneratedPoem should verify parent_poem_id on readback',
    );
    TestAssertion.assertEquals(
      1,
      countAiRows(database, parentPoem.id),
      'persistGeneratedPoem should write exactly one AI row for first insert',
    );

    const persistedAgain = await persistGeneratedPoem({
      db: persistenceDb,
      parentPoem,
      generatedPoem: generatedPoem('Stored Counterpart'),
      prompt: 'Prompt for phase4-human-1',
      model: 'gemini-3-flash-preview',
    });
    TestAssertion.assertEquals(
      persisted.id,
      persistedAgain.id,
      'persistGeneratedPoem should remain idempotent for the same parent/model',
    );
    TestAssertion.assertEquals(
      1,
      countAiRows(database, parentPoem.id),
      'persistGeneratedPoem should ignore duplicate inserts',
    );

    database.run('BEGIN');
    try {
      const rollbackParent = unmatchedAll.find((poem) => poem.id === 'phase4-human-3');
      TestAssertion.assertNotNull(
        rollbackParent,
        'Seed data should include unmatched parent poem phase4-human-3',
      );
      if (!rollbackParent) {
        throw new Error('Unable to continue rollback test without phase4-human-3.');
      }

      await persistGeneratedPoem({
        db: persistenceDb,
        parentPoem: rollbackParent,
        generatedPoem: generatedPoem('Rollback Candidate'),
        prompt: 'Prompt for rollback test',
        model: 'gemini-3-flash-preview',
      });
      TestAssertion.assertEquals(
        1,
        countAiRows(database, rollbackParent.id),
        'Transaction test should stage AI row before rollback',
      );
      throw new RollbackSignal();
    } catch (error) {
      database.run('ROLLBACK');
      if (!(error instanceof RollbackSignal)) {
        throw error;
      }
    }

    TestAssertion.assertEquals(
      0,
      countAiRows(database, 'phase4-human-3'),
      'RollbackSignal should ensure transaction writes are not persisted',
    );

    const parsedConfig = parseCliArgs([
      '--topic',
      'nature',
      '--limit',
      '3',
      '--model',
      'gemini-3-flash-preview',
      '--concurrency',
      '2',
      '--max-retries',
      '4',
    ]);
    TestAssertion.assertEquals(
      'nature',
      parsedConfig.topic ?? '',
      'parseCliArgs should parse --topic',
    );
    TestAssertion.assertEquals(3, parsedConfig.limit ?? 0, 'parseCliArgs should parse --limit');
    TestAssertion.assertEquals(
      2,
      parsedConfig.concurrency,
      'parseCliArgs should parse --concurrency as positive integer',
    );
    TestAssertion.assertEquals(
      4,
      parsedConfig.maxRetries,
      'parseCliArgs should parse --max-retries',
    );

    const defaultConfig = parseCliArgs([]);
    TestAssertion.assertEquals(
      undefined,
      defaultConfig.limit,
      'parseCliArgs should default --limit to undefined (all unmatched)',
    );

    const logs: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const cliConfig: CliConfig = parsedConfig;
    const cliSummary = await runGenerationCli(cliConfig, {
      fetchPoems: async (config) =>
        fetchUnmatchedHumanPoems({
          db: persistenceDb,
          topic: config.topic,
          limit: config.limit,
        }),
      processPoem: async (poem, config): Promise<ProcessPoemResult> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Bun.sleep(20);
        inFlight -= 1;

        if (poem.id === 'phase4-human-4') {
          const storedPoem = await persistGeneratedPoem({
            db: persistenceDb,
            parentPoem: poem,
            generatedPoem: generatedPoem('CLI Stored Counterpart'),
            prompt: `CLI prompt for ${poem.id}`,
            model: config.model,
          });
          return {
            poemId: poem.id,
            status: 'stored',
            storedPoemId: storedPoem.id,
          };
        }

        if (poem.id === 'phase4-human-5') {
          return {
            poemId: poem.id,
            status: 'skipped',
            reason: 'quality_rejected',
          };
        }

        throw new Error('simulated_provider_failure');
      },
      log: (line) => {
        logs.push(line);
      },
    });

    TestAssertion.assertEquals(
      3,
      cliSummary.totalCandidates,
      'runGenerationCli should process the configured batch size for unmatched poems',
    );
    TestAssertion.assertEquals(
      3,
      cliSummary.processed,
      'runGenerationCli should track processed count',
    );
    TestAssertion.assertEquals(1, cliSummary.stored, 'runGenerationCli should track stored count');
    TestAssertion.assertEquals(
      1,
      cliSummary.skipped,
      'runGenerationCli should track skipped count',
    );
    TestAssertion.assertEquals(1, cliSummary.failed, 'runGenerationCli should track failed count');
    TestAssertion.assertTrue(
      maxInFlight <= cliConfig.concurrency,
      'runGenerationCli should respect configured concurrency limit',
    );
    TestAssertion.assertTrue(
      logs.some((line) => line.includes('Stored AI poem for phase4-human-4')),
      'runGenerationCli should log stored poem output',
    );
    TestAssertion.assertTrue(
      logs.some((line) => line.includes('Completed generation run')),
      'runGenerationCli should log final summary output',
    );
    TestAssertion.assertEquals(
      1,
      countAiRows(database, 'phase4-human-4'),
      'CLI processPoem path should persist AI row for stored poem result',
    );

    const remainingNature = await fetchUnmatchedHumanPoems({
      db: persistenceDb,
      topic: 'nature',
    });
    const remainingIds = new Set(remainingNature.map((poem) => poem.id));
    TestAssertion.assertTrue(
      !remainingIds.has('phase4-human-4'),
      'Stored poem should no longer appear in unmatched-human query results',
    );
    TestAssertion.assertTrue(
      remainingIds.has('phase4-human-5') && remainingIds.has('phase4-human-6'),
      'Skipped/failed poems should remain unmatched for resumable runs',
    );

    TestLogger.endPhase('Execution: direct persistence + CLI integration checks');
    allPassed = TestAssertion.summary();
  } catch (error) {
    TestLogger.error('Fatal error in Phase 4 manual verification script', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    allPassed = false;
  } finally {
    if (database) {
      await tracker.cleanup();
      database.close();
    }

    if (tempDbPath && existsSync(tempDbPath)) {
      rmSync(tempDbPath, { force: true });
      TestLogger.info('Removed temporary sqlite database', { tempDbPath });
    }

    TestLogger.info('=== Manual Test Run Completed ===', {
      result: allPassed ? 'PASSED' : 'FAILED',
      logFile,
    });

    console.log('');
    console.log('============================================');
    console.log('Phase 4 AI-Gen Manual Verification Complete');
    console.log('============================================');
    console.log(`Test ID : ${testRunId}`);
    console.log(`Result  : ${allPassed ? 'PASS' : 'FAIL'}`);
    console.log(`Logs    : ${logFile}`);
    console.log('============================================');
    console.log('');

    if (!allPassed) {
      process.exitCode = 1;
    }
  }
}

void main();
