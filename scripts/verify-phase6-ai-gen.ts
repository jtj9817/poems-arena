#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 6: Documentation
 * Purpose: Verify documentation deliverables for AI generation Phase 6
 *
 * Run with: bun scripts/verify-phase6-ai-gen.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TestAssertion, TestLogger } from './manual-test-helpers';

const testRunId = `phase6_ai_gen_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

function readUtf8(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function assertIncludes(content: string, needle: string, message: string): void {
  TestAssertion.assertTrue(content.includes(needle), message);
}

function main(): void {
  TestLogger.info('=== Starting Manual Verification: Phase 6 Documentation ===', {
    testRunId,
    logFile,
  });

  const planPath = path.join(repoRoot, 'docs', 'plans', '001-data-pipeline-plan.md');
  const readmePath = path.join(repoRoot, 'packages', 'ai-gen', 'README.md');
  const promptsDocPath = path.join(repoRoot, 'docs', 'backend', 'ai-gen-gemini-prompts.md');

  TestAssertion.assertTrue(existsSync(planPath), 'Data pipeline plan document exists');
  TestAssertion.assertTrue(existsSync(readmePath), 'AI generation package README exists');
  TestAssertion.assertTrue(existsSync(promptsDocPath), 'Gemini prompt documentation exists');

  const planDoc = readUtf8(planPath);
  const packageReadme = readUtf8(readmePath);
  const promptsDoc = readUtf8(promptsDocPath);

  assertIncludes(planDoc, 'Call Gemini API', 'Plan references Gemini API integration');
  assertIncludes(planDoc, 'gemini-3-flash-preview', 'Plan references Gemini model default');
  TestAssertion.assertTrue(
    !planDoc.includes('ANTHROPIC_API_KEY'),
    'Plan no longer references ANTHROPIC_API_KEY',
  );

  assertIncludes(packageReadme, 'GEMINI_API_KEY', 'README documents GEMINI_API_KEY');
  assertIncludes(packageReadme, 'GOOGLE_API_KEY', 'README documents GOOGLE_API_KEY fallback');
  assertIncludes(packageReadme, '--topic', 'README documents --topic CLI flag');
  assertIncludes(packageReadme, '--limit', 'README documents --limit CLI flag');
  assertIncludes(packageReadme, '--concurrency', 'README documents --concurrency CLI flag');
  assertIncludes(packageReadme, '--max-retries', 'README documents --max-retries CLI flag');

  assertIncludes(
    promptsDoc,
    'system-instructions.md',
    'Prompt doc references system instructions source file',
  );
  assertIncludes(
    promptsDoc,
    'verification-agent.ts',
    'Prompt doc references verification prompt source',
  );
  assertIncludes(
    promptsDoc,
    'responseMimeType: "application/json"',
    'Prompt doc records JSON mode usage',
  );

  const allPassed = TestAssertion.summary();
  if (!allPassed) {
    TestLogger.error('Phase 6 documentation verification failed.');
    process.exit(1);
  }

  TestLogger.info('Phase 6 documentation verification passed.');
}

main();
