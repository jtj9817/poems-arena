#!/usr/bin/env bun
/**
 * Manual Test Script: Phase 4 — Documentation
 * Track: Randomized Duel Ordering
 * Plan: conductor/tracks/randomized_duel_ordering_20260310/plan.md
 *
 * Purpose:
 *   Verify the shipped seeded-ordering contract is documented across backend,
 *   frontend, and plan docs.
 *
 * Run with: bun scripts/verify-phase4-randomized-duel-ordering.ts
 */

import path from 'node:path';
import process from 'node:process';
import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

const testRunId = `phase4_randomized_duel_ordering_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const API_REFERENCE_PATH = path.join(repoRoot, 'docs', 'backend', 'api-reference.md');
const FRONTEND_COMPONENTS_PATH = path.join(repoRoot, 'docs', 'frontend', 'components.md');
const RANDOMIZATION_PLAN_PATH = path.join(
  repoRoot,
  'docs',
  'plans',
  '002-duel-randomization-plan.md',
);

type CheckFn = () => void | Promise<void>;

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  TestLogger.startPhase(name);
  const failuresBefore = TestAssertion.counts().failed;
  try {
    await fn();
    const failuresAfter = TestAssertion.counts().failed;
    if (failuresAfter > failuresBefore) {
      TestLogger.error(`FAIL: ${name}`, { newFailures: failuresAfter - failuresBefore });
      return false;
    }
    TestLogger.endPhase(name);
    return true;
  } catch (error) {
    TestLogger.error(`FAIL: ${name}`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info('=== Starting Manual Test: Phase 4 — Documentation ===', {
    testRunId,
    logFile,
  });

  let passed = 0;
  let failed = 0;
  const tally = (ok: boolean) => {
    if (ok) passed += 1;
    else failed += 1;
  };

  const apiRef = await Bun.file(API_REFERENCE_PATH).text();
  const frontendDocs = await Bun.file(FRONTEND_COMPONENTS_PATH).text();
  const planDoc = await Bun.file(RANDOMIZATION_PLAN_PATH).text();

  tally(
    await runCheck('A1: backend docs require seed unless sort=recent', () => {
      TestAssertion.assertTrue(
        apiRef.includes('seed` (required unless `sort=recent`)'),
        'api-reference.md must document required seed unless sort=recent',
      );
    }),
  );

  tally(
    await runCheck('A2: backend docs include INVALID_SEED and MISSING_SEED', () => {
      TestAssertion.assertTrue(
        apiRef.includes('`INVALID_SEED`'),
        'api-reference.md must document INVALID_SEED',
      );
      TestAssertion.assertTrue(
        apiRef.includes('`MISSING_SEED`'),
        'api-reference.md must document MISSING_SEED',
      );
    }),
  );

  tally(
    await runCheck('A3: backend docs describe non-negative safe integer seed validation', () => {
      TestAssertion.assertTrue(
        apiRef.includes('non-negative safe integer'),
        'api-reference.md must document safe-integer seed validation',
      );
    }),
  );

  tally(
    await runCheck('B1: frontend docs describe Home session-seeded behavior', () => {
      TestAssertion.assertTrue(
        frontendDocs.includes('session-scoped seed') &&
          frontendDocs.includes('api.getDuels(1, undefined, seed)'),
        'components.md must document Home session-seeded getDuels behavior',
      );
    }),
  );

  tally(
    await runCheck('B2: frontend docs describe Past Bouts sort=recent path', () => {
      TestAssertion.assertTrue(
        frontendDocs.includes('sort=recent') && frontendDocs.includes('Past Bouts'),
        'components.md must document Past Bouts sort=recent archive path',
      );
    }),
  );

  tally(
    await runCheck('B3: frontend docs list corrected getDuels signature and PAGE_SIZE=12', () => {
      TestAssertion.assertTrue(
        frontendDocs.includes("sort?: 'recent'"),
        'components.md must include getDuels sort parameter in API signature',
      );
      TestAssertion.assertTrue(
        frontendDocs.includes('| `PAGE_SIZE` | `12` |'),
        'components.md must document PAGE_SIZE=12 alignment with API',
      );
    }),
  );

  tally(
    await runCheck('C1: plan doc marks shipped status', () => {
      TestAssertion.assertTrue(
        planDoc.includes('**Status:** SHIPPED'),
        '002-duel-randomization-plan.md must mark shipped status',
      );
    }),
  );

  tally(
    await runCheck('C2: plan doc captures final shipped behavior details', () => {
      TestAssertion.assertTrue(
        planDoc.includes('Shipped Behavior (2026-03-11)'),
        '002-duel-randomization-plan.md must include final shipped behavior section',
      );
      TestAssertion.assertTrue(
        planDoc.includes('Deep-linking into The Ring still opens the requested duel first'),
        'final behavior section must mention deep-link continuation into seeded stream',
      );
    }),
  );

  const allAssertionsPassed = TestAssertion.summary();
  TestLogger.info('Manual verification run complete', {
    checksPassed: passed,
    checksFailed: failed,
    assertionsPassed: allAssertionsPassed,
  });

  if (failed > 0 || !allAssertionsPassed) {
    process.exit(1);
  }
}

void main();
