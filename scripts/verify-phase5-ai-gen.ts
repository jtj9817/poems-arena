#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 5: Regression & Quality Gate
 * Generated: 2026-02-24
 * Purpose: Verify regression gates and Phase 5 feature behaviors for @sanctuary/ai-gen
 *
 * Run with: bun scripts/verify-phase5-ai-gen.ts
 */

import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  runGenerationCli,
  type CliConfig,
  type ProcessPoemResult,
} from '../packages/ai-gen/src/cli';
import type { PoemOutput } from '../packages/ai-gen/src/gemini-client';
import {
  fetchUnmatchedHumanPoems,
  persistGeneratedPoem,
  type PersistenceDb,
} from '../packages/ai-gen/src/persistence';
import { validateGeneratedPoemQuality } from '../packages/ai-gen/src/quality-validator';
import { DataTracker, TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  captureOutput?: boolean;
}

const testRunId = `phase5_ai_gen_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
let database: Database | null = null;
let tempDbPath: string | null = null;
let allPassed = false;

const PHASE5_IDS = {
  humans: ['phase5-human-1', 'phase5-human-2', 'phase5-human-3'],
} as const;

function countNonEmptyLines(content: string): number {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

async function streamAndCaptureOutput(
  stream: ReadableStream<Uint8Array> | null,
  write: (chunk: string) => void,
): Promise<string> {
  if (!stream) {
    return '';
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    output += chunk;
    write(chunk);
  }

  const trailing = decoder.decode();
  if (trailing) {
    output += trailing;
    write(trailing);
  }

  return output;
}

async function runCommand(command: string[], options: CommandOptions = {}): Promise<CommandResult> {
  const startedAt = Date.now();
  const captureOutput = options.captureOutput ?? false;
  const proc = Bun.spawn(command, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    stdout: captureOutput ? 'pipe' : 'inherit',
    stderr: captureOutput ? 'pipe' : 'inherit',
  });
  let timedOut = false;
  const timeoutHandle =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          TestLogger.warning('Command timeout reached; terminating process', {
            command: command.join(' '),
            timeoutMs: options.timeoutMs,
          });
          proc.kill('SIGTERM');
        }, options.timeoutMs)
      : null;

  const [stdout, stderr] = captureOutput
    ? await Promise.all([
        streamAndCaptureOutput(proc.stdout, (chunk) => process.stdout.write(chunk)),
        streamAndCaptureOutput(proc.stderr, (chunk) => process.stderr.write(chunk)),
      ])
    : ['', ''];

  if (timedOut) {
    const exitedAfterTerm = await Promise.race([
      proc.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!exitedAfterTerm) {
      TestLogger.warning('Process did not terminate after SIGTERM; sending SIGKILL', {
        command: command.join(' '),
      });
      proc.kill('SIGKILL');
    }
  }
  await proc.exited;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  const durationMs = Date.now() - startedAt;

  return {
    exitCode: proc.exitCode ?? (timedOut ? 124 : 1),
    stdout,
    stderr,
    timedOut,
    durationMs,
  };
}

interface TimeoutDiagnostic {
  command: string[];
  timeoutMs?: number;
}

async function logProcessSnapshot(context: string): Promise<void> {
  const snapshot = await runCommand(['ps', '-eo', 'pid,ppid,pgid,stat,etime,command'], {
    captureOutput: true,
    timeoutMs: 5_000,
  });

  if (snapshot.exitCode !== 0 || !snapshot.stdout.trim()) {
    TestLogger.warning('Unable to capture process snapshot', {
      context,
      exitCode: snapshot.exitCode,
      timedOut: snapshot.timedOut,
    });
    return;
  }

  const relevantLines = snapshot.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        /(pnpm|prettier|eslint)/i.test(line) ||
        /bun\s+(scripts\/verify-phase5-ai-gen\.ts|test)/i.test(line),
    )
    .slice(0, 40);

  if (relevantLines.length === 0) {
    TestLogger.info('Process snapshot captured with no relevant formatter/test processes', {
      context,
    });
    return;
  }

  TestLogger.warning('Relevant process snapshot', {
    context,
    lines: relevantLines,
  });
}

async function runAndAssertCommand(
  name: string,
  command: string[],
  opts: { parseCoverage?: boolean; timeoutMs?: number; timeoutDiagnostic?: TimeoutDiagnostic } = {},
): Promise<number | undefined> {
  TestLogger.info(`Running command for ${name}`, {
    command: command.join(' '),
    timeoutMs: opts.timeoutMs,
  });
  console.log(`\n$ ${command.join(' ')}`);

  const result = await runCommand(command, {
    env: { CI: 'true' },
    timeoutMs: opts.timeoutMs,
    captureOutput: opts.parseCoverage,
  });

  TestLogger.info(`Command completed for ${name}`, {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  });

  if (result.timedOut) {
    TestLogger.error(`Command timed out for ${name}`, {
      command: command.join(' '),
      timeoutMs: opts.timeoutMs,
    });
    await logProcessSnapshot(`${name} timeout`);

    if (opts.timeoutDiagnostic) {
      const diagnosticCommand = opts.timeoutDiagnostic.command;
      TestLogger.info(`Running timeout diagnostic for ${name}`, {
        command: diagnosticCommand.join(' '),
        timeoutMs: opts.timeoutDiagnostic.timeoutMs,
      });
      console.log(`\n$ ${diagnosticCommand.join(' ')}`);

      await runCommand(diagnosticCommand, {
        env: { ...process.env, CI: 'true' },
        timeoutMs: opts.timeoutDiagnostic.timeoutMs,
        captureOutput: false,
      });
    }

    throw new Error(
      `${name} timed out after ${opts.timeoutMs ?? result.durationMs}ms (exit code ${result.exitCode})`,
    );
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `${name} failed with exit code ${result.exitCode} after ${result.durationMs}ms`,
    );
  }

  if (!opts.parseCoverage) {
    return undefined;
  }

  const coveragePattern = /All files\s+\|\s+[\d.]+\s+\|\s+([\d.]+)\s+\|/;
  const coverageOutput = `${result.stdout}\n${result.stderr}`;
  const match = coveragePattern.exec(coverageOutput);
  if (!match) {
    throw new Error('Unable to parse overall line coverage from coverage output.');
  }

  const lineCoverage = Number(match[1]);
  if (!Number.isFinite(lineCoverage)) {
    throw new Error(`Parsed non-numeric line coverage value: ${match[1]}`);
  }

  return lineCoverage;
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
}

function seedFixtures(localDb: Database): void {
  for (const id of PHASE5_IDS.humans) {
    localDb.run(
      `INSERT INTO poems (id, title, content, author, type, source, prompt, parent_poem_id)
       VALUES (?, ?, ?, ?, 'HUMAN', NULL, NULL, NULL)`,
      [id, `Human ${id}`, 'line 1\nline 2\nline 3\nline 4\nline 5', 'Human Author'],
    );
  }
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

function countTotalAiRows(localDb: Database): number {
  const row = localDb
    .query(
      `SELECT COUNT(*) AS total
       FROM poems
       WHERE type = 'AI'`,
    )
    .get() as { total: number };
  return Number(row.total);
}

function generatedPoemById(poemId: string): PoemOutput {
  if (poemId === 'phase5-human-2') {
    return {
      title: 'Invalid Counterpart',
      content:
        'Here is a poem about moonlight\nline two glows softly\nline three drifts onward\nline four fades to ash',
    };
  }

  return {
    title: `Counterpart for ${poemId}`,
    content: 'line one\nline two\nline three\nline four\nline five',
  };
}

async function main(): Promise<void> {
  TestLogger.info('=== Starting Manual Test: Phase 5 Regression & Quality Gate ===', {
    testRunId,
    logFile,
  });

  try {
    TestLogger.startPhase('Setup');

    tempDbPath = path.join(
      tmpdir(),
      `classicist-sanctuary-ai-gen-phase5-${Date.now()}-${process.pid}.sqlite`,
    );
    database = new Database(tempDbPath, { create: true });

    initializeSchema(database);
    seedFixtures(database);
    tracker.track('phase5_seed_data', [...PHASE5_IDS.humans], async () => {
      if (!database) {
        return;
      }
      database.run(`DELETE FROM poems WHERE id LIKE 'ai-phase5-%' OR id LIKE 'phase5-human-%'`);
    });

    TestLogger.endPhase('Setup');

    TestLogger.startPhase('Execution: Coverage and regression verification');
    await runAndAssertCommand('ai-gen test suite', [
      'pnpm',
      '--filter',
      '@sanctuary/ai-gen',
      'test',
    ]);
    const coverage = await runAndAssertCommand(
      'ai-gen test coverage',
      ['pnpm', '--filter', '@sanctuary/ai-gen', 'exec', 'bun', 'test', '--coverage'],
      { parseCoverage: true },
    );
    TestAssertion.assertTrue(
      typeof coverage === 'number' && coverage >= 80,
      `Coverage must be >=80% for Phase 5 (actual: ${coverage?.toFixed(2) ?? 'n/a'}%)`,
    );
    await runAndAssertCommand('workspace lint', ['pnpm', 'lint']);
    const verboseFormatCheck = process.env.PHASE5_FORMAT_CHECK_DEBUG === '1';
    const formatCheckCommand = verboseFormatCheck
      ? ['pnpm', 'exec', 'prettier', '--check', '.', '--log-level', 'debug']
      : ['pnpm', 'format:check'];
    if (verboseFormatCheck) {
      TestLogger.info('Format check debug mode enabled via PHASE5_FORMAT_CHECK_DEBUG=1');
    }

    await runAndAssertCommand('workspace format check', formatCheckCommand, {
      timeoutMs: 120_000,
      timeoutDiagnostic: {
        command: ['pnpm', 'exec', 'prettier', '--check', '.', '--log-level', 'debug'],
        timeoutMs: 60_000,
      },
    });
    TestLogger.endPhase('Execution: Coverage and regression verification');

    TestLogger.startPhase('Execution: Regression checklist (feature behaviors)');
    const persistenceDb = createPersistenceDb(database);
    const logs: string[] = [];

    const config: CliConfig = {
      topic: undefined,
      limit: undefined,
      model: 'gemini-3-flash-preview',
      concurrency: 2,
      maxRetries: 2,
    };

    const dependencies = {
      fetchPoems: async (cliConfig: CliConfig) =>
        fetchUnmatchedHumanPoems({
          db: persistenceDb,
          topic: cliConfig.topic,
          limit: cliConfig.limit,
        }),
      processPoem: async (poem: {
        id: string;
        title: string;
        content: string;
      }): Promise<ProcessPoemResult> => {
        const generatedPoem = generatedPoemById(poem.id);
        const validation = validateGeneratedPoemQuality({
          generatedPoem,
          parentLineCount: Math.max(countNonEmptyLines(poem.content), 4),
          verification: {
            isValid: true,
            score: 92,
            feedback: 'Verifier accepted output',
          },
        });

        if (!validation.isValid) {
          return {
            poemId: poem.id,
            status: 'skipped',
            reason: validation.issues.join(','),
          };
        }

        const storedPoem = await persistGeneratedPoem({
          db: persistenceDb,
          parentPoem: poem,
          generatedPoem,
          prompt: `Phase 5 regression prompt for ${poem.id}`,
          model: config.model,
        });

        return {
          poemId: poem.id,
          status: 'stored',
          storedPoemId: storedPoem.id,
        };
      },
      log: (line: string) => {
        logs.push(line);
      },
    };

    const firstRun = await runGenerationCli(config, dependencies);
    TestAssertion.assertEquals(
      3,
      firstRun.totalCandidates,
      'CLI should process the initial batch of unmatched human poems',
    );
    TestAssertion.assertEquals(2, firstRun.stored, 'CLI should store valid generated AI poems');
    TestAssertion.assertEquals(
      1,
      firstRun.skipped,
      'CLI should skip non-conforming generated responses',
    );
    TestAssertion.assertEquals(
      0,
      firstRun.failed,
      'CLI should avoid failures for deterministic regression inputs',
    );
    TestAssertion.assertTrue(
      logs.some((line) => line.includes('Stored AI poem')),
      'CLI run should log stored AI poem output',
    );

    const skippedResult = firstRun.results.find((result) => result.poemId === 'phase5-human-2');
    TestAssertion.assertNotNull(
      skippedResult,
      'Regression run should include phase5-human-2 skip result for validation check',
    );
    TestAssertion.assertTrue(
      skippedResult?.status === 'skipped' &&
        (skippedResult.reason ?? '').includes('contains_meta_text'),
      'Validation should reject non-conforming response containing meta-text',
    );

    TestAssertion.assertEquals(
      1,
      countAiRows(database, 'phase5-human-1'),
      'First CLI run should create one AI counterpart for phase5-human-1',
    );
    TestAssertion.assertEquals(
      1,
      countAiRows(database, 'phase5-human-3'),
      'First CLI run should create one AI counterpart for phase5-human-3',
    );

    const secondRun = await runGenerationCli(config, dependencies);
    TestAssertion.assertEquals(
      0,
      secondRun.stored,
      'Rerunning CLI should not store duplicates for already matched poems',
    );
    TestAssertion.assertEquals(
      1,
      secondRun.totalCandidates,
      'Rerun should only include still-unmatched poem(s)',
    );
    TestAssertion.assertEquals(
      1,
      secondRun.skipped,
      'Rerun should keep rejecting the same non-conforming generated response',
    );

    TestAssertion.assertEquals(
      1,
      countAiRows(database, 'phase5-human-1'),
      'Rerun should keep idempotent AI counterpart count for phase5-human-1',
    );
    TestAssertion.assertEquals(
      1,
      countAiRows(database, 'phase5-human-3'),
      'Rerun should keep idempotent AI counterpart count for phase5-human-3',
    );
    TestAssertion.assertEquals(
      2,
      countTotalAiRows(database),
      'Rerun should not increase total AI counterpart rows',
    );

    TestLogger.endPhase('Execution: Regression checklist (feature behaviors)');
    allPassed = TestAssertion.summary();
  } catch (error) {
    TestLogger.error('Fatal error in Phase 5 manual verification script', {
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
    console.log('Phase 5 AI-Gen Manual Verification Complete');
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
