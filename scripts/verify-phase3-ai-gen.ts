#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 3: Validation and Quality Checks
 * Generated: 2026-02-24
 * Purpose: Verify quality-validator behavior for @sanctuary/ai-gen
 *
 * Run with: bun scripts/verify-phase3-ai-gen.ts
 */

import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { PoemOutput } from '../packages/ai-gen/src/gemini-client';
import { validateGeneratedPoemQuality } from '../packages/ai-gen/src/quality-validator';
import type { PoemVerificationResult } from '../packages/ai-gen/src/verification-agent';

type CheckFn = () => void | Promise<void>;

const testRunId = `phase3_ai_gen_${new Date().toISOString().replace(/[:.]/g, '_')}`;
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

function assertIncludes<T>(haystack: T[], needle: T, message: string): void {
  if (!haystack.includes(needle)) {
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

function poem(content: string, title = 'Generated Title'): PoemOutput {
  return { title, content };
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
  log('INFO', '=== Starting Manual Test: Phase 3 Validation and Quality Checks ===', {
    testRunId,
  });

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Manual verification is blocked when NODE_ENV=production.');
  }

  let passed = 0;
  let failed = 0;

  // Setup phase
  const setupPassed = await runCheck('Setup: required Phase 3 files exist', async () => {
    const requiredFiles = [
      path.join(repoRoot, 'packages/ai-gen/src/quality-validator.ts'),
      path.join(repoRoot, 'packages/ai-gen/src/quality-validator.test.ts'),
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

  // Execution phase
  const testsPassed = await runCheck('Execution: quality-validator test suite passes', async () => {
    const command = [
      'pnpm',
      '--filter',
      '@sanctuary/ai-gen',
      'test',
      '--',
      'src/quality-validator.test.ts',
    ];
    log('INFO', 'Running command', { command: command.join(' ') });

    const result = await runCommand(command, {
      env: { CI: 'true' },
    });

    log('INFO', 'Command finished', {
      exitCode: result.exitCode,
    });

    if (result.stdout.trim()) {
      log('INFO', 'Command stdout', { output: result.stdout.trim() });
    }
    if (result.stderr.trim()) {
      log('INFO', 'Command stderr', { output: result.stderr.trim() });
    }

    assertTrue(
      result.exitCode === 0,
      `quality-validator test command failed with exit code ${result.exitCode}`,
    );
  });
  if (testsPassed) {
    passed++;
  } else {
    failed++;
  }

  const behaviorChecksPassed = await runCheck(
    'Execution: direct runtime checks for Phase 3 validation rules',
    async () => {
      const belowMinimum = validateGeneratedPoemQuality({
        generatedPoem: poem('line one\nline two\nline three'),
        parentLineCount: 10,
      });
      assertIncludes(
        belowMinimum.issues,
        'line_count_below_minimum',
        'Expected line_count_below_minimum issue for a 3-line poem.',
      );
      assertTrue(
        belowMinimum.shouldRetry,
        'Expected shouldRetry=true for below-minimum line count.',
      );

      const outOfRange = validateGeneratedPoemQuality({
        generatedPoem: poem('1\n2\n3\n4\n5\n6\n7\n8'),
        parentLineCount: 6,
      });
      assertIncludes(
        outOfRange.issues,
        'line_count_out_of_range',
        'Expected line_count_out_of_range issue for strict +/-20% overflow.',
      );
      assertTrue(outOfRange.shouldRetry, 'Expected shouldRetry=true for out-of-range line count.');

      const metaText = validateGeneratedPoemQuality({
        generatedPoem: poem('Here is a poem\nline two\nline three\nline four'),
        parentLineCount: 4,
      });
      assertIncludes(
        metaText.issues,
        'contains_meta_text',
        'Expected contains_meta_text issue for conversational filler.',
      );

      const malformed = validateGeneratedPoemQuality({
        generatedPoem: { title: 'Broken' } as unknown as PoemOutput,
        parentLineCount: 4,
      });
      assertIncludes(
        malformed.issues,
        'invalid_output_shape',
        'Expected invalid_output_shape issue for malformed runtime payload.',
      );
      assertTrue(
        malformed.shouldRetry === false,
        'Expected shouldRetry=false when output shape is invalid.',
      );

      const lowVerification: PoemVerificationResult = {
        isValid: true,
        score: 50,
        feedback: 'Needs stronger imagery.',
      };
      const verificationRejected = validateGeneratedPoemQuality({
        generatedPoem: poem('line one\nline two\nline three\nline four'),
        parentLineCount: 4,
        verification: lowVerification,
      });
      assertIncludes(
        verificationRejected.issues,
        'verification_below_threshold',
        'Expected verification_below_threshold issue for low verification score.',
      );

      const acceptedVerification: PoemVerificationResult = {
        isValid: true,
        score: 90,
        feedback: 'Strong and cohesive.',
      };
      const validPoem = validateGeneratedPoemQuality({
        generatedPoem: poem('line one\nline two\nline three\nline four\nline five'),
        parentLineCount: 6,
        verification: acceptedVerification,
      });
      assertTrue(
        validPoem.isValid,
        'Expected valid output for poem meeting all quality constraints.',
      );
      assertTrue(validPoem.issues.length === 0, 'Expected no issues for a valid poem.');
      assertTrue(validPoem.shouldRetry === false, 'Expected shouldRetry=false for valid poem.');
    },
  );
  if (behaviorChecksPassed) {
    passed++;
  } else {
    failed++;
  }

  // Cleanup phase
  await runCheck('Cleanup: no persistent data cleanup required', async () => {
    log('INFO', 'No database writes or persistent artifacts were created by this script.');
  });

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
  log('ERROR', 'Fatal error in Phase 3 manual verification script', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
