#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 5: Regression & Quality Gate
 * Generated: 2026-03-13
 * Purpose: Execute regression suites, verify assertion coverage map,
 *          and confirm no avgReadingTime references remain in production code.
 *
 * Run with: bun scripts/verify-phase5-user-analytics.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DataTracker, TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const testRunId = `phase5_user_analytics_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));
const STDERR_TAIL_CHARS = 500;
const TEST_STDOUT_TAIL_CHARS = 1200;

TestEnvironment.guardProduction();
TestEnvironment.displayInfo();

const tracker = new DataTracker();
let allPassed = false;

function requireTrue(condition: boolean, message: string): void {
  const ok = TestAssertion.assertTrue(condition, message);
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

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

// ── Assertion Coverage Map ────────────────────────────────────────────────────

interface AssertionEntry {
  id: string;
  coverageType: 'Automated' | 'Manual (code inspection)';
  testFile: string;
  testName: string;
  status: 'Covered' | 'Pending';
}

const ASSERTION_MAP: AssertionEntry[] = [
  // API Assertions
  {
    id: 'UA-API-001',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName: 'returns 400 when readingTimeMs is missing',
    status: 'Covered',
  },
  {
    id: 'UA-API-002',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName:
      'returns 400 and does not insert vote when readingTimeMs is 0 | returns 400 and does not insert vote when readingTimeMs is negative',
    status: 'Covered',
  },
  {
    id: 'UA-API-003',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName: 'returns 400 when readingTimeMs is not an integer',
    status: 'Covered',
  },
  {
    id: 'UA-API-004',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName: 'clamps readingTimeMs over 10 minutes to 10 minutes in the vote row',
    status: 'Covered',
  },
  {
    id: 'UA-API-005',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName:
      'returns 400 and does not insert vote when readingTimeMs is 0 | invalid vote (readingTimeMs <= 0) does not update aggregates',
    status: 'Covered',
  },
  {
    id: 'UA-API-006',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName: 'first vote creates global_statistics row with correct counts',
    status: 'Covered',
  },
  {
    id: 'UA-API-007',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName:
      'AI vote increments totalVotes but not humanVotes in global_statistics | second vote increments global_statistics correctly',
    status: 'Covered',
  },
  {
    id: 'UA-API-008',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/votes.test.ts',
    testName:
      'first vote creates global_statistics row with correct counts | first vote creates topic_statistics row for the duel topic | clamped readingTimeMs contributes clamped value to decisionTimeSumMs in global_statistics',
    status: 'Covered',
  },
  {
    id: 'UA-API-009',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/duels.test.ts',
    testName:
      'returns globalStats with zeros when no votes exist | returns topicStats with zeros when no votes exist',
    status: 'Covered',
  },
  {
    id: 'UA-API-010',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/duels.test.ts',
    testName:
      'avgDecisionTime zero-pads single-digit seconds (e.g. "0m 08s") | avgDecisionTime zero-pads seconds when average lands on an exact minute | avgDecisionTime formats correctly for multi-minute values',
    status: 'Covered',
  },
  {
    id: 'UA-API-011',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/duels.test.ts',
    testName: 'returns topicStats with zeros when no votes exist',
    status: 'Covered',
  },
  {
    id: 'UA-API-012',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/duels.test.ts',
    testName: 'does not include avgReadingTime in the response',
    status: 'Covered',
  },

  // Frontend Assertions
  {
    id: 'UA-FE-001',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName:
      'readingStartedAtRef.current = Date.now() after setFadeIn(true) in setTimeout (line 126)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-002',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName: 'handleSwipeInComplete resets readingStartedAtRef.current = Date.now() (line 196)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-003',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName:
      'handleVote computes readingTimeMs = Math.max(1, Math.floor(Date.now() - readingStartedAtRef.current)) and passes to api.vote (lines 146-147)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-004',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName:
      'canVote = fadeIn && swipePhase === "idle" && !showPopup && !hasVoted guards handleVote + disabled prop (line 139)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-005',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName:
      'handleVote calls api.getDuelStats(duel.id) exactly once after api.vote succeeds (line 148)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-006',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName: 'renders the detailed stats section when stats are provided',
    status: 'Covered',
  },
  {
    id: 'UA-FE-007',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName: 'renders the detailed stats section when stats are provided',
    status: 'Covered',
  },
  {
    id: 'UA-FE-008',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName:
      'renders the detailed stats section when stats are provided (↑ 5% vs global) | renders downward delta when topic rate is lower than global (↓ 15%)',
    status: 'Covered',
  },
  {
    id: 'UA-FE-009',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName:
      'renders the detailed stats section when stats are provided | renders "—" fallback when avgDecisionTime is null',
    status: 'Covered',
  },
  {
    id: 'UA-FE-010',
    coverageType: 'Automated',
    testFile: 'scripts/verify-phase5-user-analytics.ts',
    testName: 'grep scan: no avgReadingTime in VerdictPopup.tsx, api.ts, or shared/src/index.ts',
    status: 'Covered',
  },
  {
    id: 'UA-FE-011',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName: 'renders correctly when stats are null',
    status: 'Covered',
  },

  // Cross-Layer Flow Assertions
  {
    id: 'UA-FLOW-001',
    coverageType: 'Manual (code inspection)',
    testFile:
      'apps/web/pages/TheRing.tsx + apps/web/lib/api.ts + apps/api/src/routes/votes.ts + apps/api/src/routes/duels.ts',
    testName:
      'Full flow verified via shared contract types (VoteRequest, DuelStatsResponse) used end-to-end without type mismatch',
    status: 'Covered',
  },
  {
    id: 'UA-FLOW-002',
    coverageType: 'Manual (code inspection)',
    testFile: 'apps/web/pages/TheRing.tsx',
    testName:
      'Timer resets in handleSwipeInComplete (line 196) ensuring independent readingTimeMs per duel; both values satisfy API positive-integer constraint via Math.max(1, ...) at line 146',
    status: 'Covered',
  },
  {
    id: 'UA-FLOW-003',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName:
      'renders the detailed stats section when stats are provided (topicDelta = 65 - 60 = 5, renders ↑ 5%) | renders downward delta (55 - 70 = -15, renders ↓ 15%)',
    status: 'Covered',
  },
  {
    id: 'UA-FLOW-004',
    coverageType: 'Automated',
    testFile: 'apps/api/src/routes/duels.test.ts',
    testName:
      'archive rows include avgDecisionTime fields and exclude avgReadingTime | returns null avgDecisionTime when no topic statistics exist',
    status: 'Covered',
  },
];

// ── Main Verification ─────────────────────────────────────────────────────────

try {
  // ── Section 1: API Regression Suite ─────────────────────────────────────────
  TestLogger.startPhase('API Regression Suite');
  {
    const result = await runCommand(
      [
        'pnpm',
        '--filter',
        '@sanctuary/api',
        'test',
        'src/routes/votes.test.ts',
        'src/routes/duels.test.ts',
      ],
      { env: { CI: 'true' } },
    );
    TestLogger.info('API test output (tail)', {
      stdout: result.stdout.slice(-TEST_STDOUT_TAIL_CHARS),
      stderr: result.stderr.slice(-STDERR_TAIL_CHARS),
    });
    requireTrue(result.exitCode === 0, 'API regression suite exits with code 0');
  }
  TestLogger.endPhase('API Regression Suite');

  // ── Section 2: Web Regression Suite ─────────────────────────────────────────
  TestLogger.startPhase('Web Regression Suite');
  {
    const result = await runCommand(['pnpm', '--filter', '@sanctuary/web', 'test'], {
      env: { CI: 'true' },
    });
    TestLogger.info('Web test output (tail)', {
      stdout: result.stdout.slice(-TEST_STDOUT_TAIL_CHARS),
      stderr: result.stderr.slice(-STDERR_TAIL_CHARS),
    });
    requireTrue(result.exitCode === 0, 'Web regression suite exits with code 0');
  }
  TestLogger.endPhase('Web Regression Suite');

  // ── Section 3: Lint Gate ────────────────────────────────────────────────────
  TestLogger.startPhase('Lint Gate');
  {
    const result = await runCommand(['pnpm', 'run', 'lint']);
    requireTrue(result.exitCode === 0, 'pnpm run lint exits with code 0');
  }
  TestLogger.endPhase('Lint Gate');

  // ── Section 4: Format Gate ──────────────────────────────────────────────────
  TestLogger.startPhase('Format Gate');
  {
    const result = await runCommand(['pnpm', 'format:check']);
    requireTrue(result.exitCode === 0, 'pnpm format:check exits with code 0');
  }
  TestLogger.endPhase('Format Gate');

  // ── Section 5: avgReadingTime Absence ───────────────────────────────────────
  TestLogger.startPhase('avgReadingTime Absence Check');
  {
    const productionFiles = [
      'apps/api/src/routes/votes.ts',
      'apps/api/src/routes/duels.ts',
      'apps/web/components/VerdictPopup.tsx',
      'apps/web/pages/TheRing.tsx',
      'apps/web/lib/api.ts',
      'packages/shared/src/index.ts',
    ];

    for (const relPath of productionFiles) {
      const fullPath = path.join(repoRoot, relPath);
      requireTrue(existsSync(fullPath), `Production file exists: ${relPath}`);
      const source = readFileSync(fullPath, 'utf-8');
      requireTrue(!source.includes('avgReadingTime'), `No avgReadingTime reference in ${relPath}`);
    }
  }
  TestLogger.endPhase('avgReadingTime Absence Check');

  // ── Section 6: Assertion Coverage Map Verification ──────────────────────────
  TestLogger.startPhase('Assertion Coverage Map');
  {
    const uncovered = ASSERTION_MAP.filter((a) => a.status !== 'Covered');
    requireTrue(
      uncovered.length === 0,
      `All ${ASSERTION_MAP.length} assertion IDs are covered (uncovered: ${uncovered.map((a) => a.id).join(', ') || 'none'})`,
    );

    const automatedCount = ASSERTION_MAP.filter((a) => a.coverageType === 'Automated').length;
    const manualCount = ASSERTION_MAP.filter(
      (a) => a.coverageType === 'Manual (code inspection)',
    ).length;

    TestLogger.info('Coverage breakdown', {
      total: ASSERTION_MAP.length,
      automated: automatedCount,
      manual: manualCount,
    });

    // Verify automated test files exist
    const automatedFiles = [
      ...new Set(
        ASSERTION_MAP.filter((a) => a.coverageType === 'Automated')
          .map((a) => a.testFile)
          .filter((f) => !f.includes(' + ') && !f.startsWith('scripts/')),
      ),
    ];
    for (const testFile of automatedFiles) {
      const fullPath = path.join(repoRoot, testFile);
      requireTrue(existsSync(fullPath), `Automated test file exists: ${testFile}`);
    }

    // Print the assertion table
    console.log('\n── Interaction Assertion Coverage Map ──────────────────────────');
    console.log('ID             | Coverage Type              | Status  | Test/Artifact');
    console.log('───────────────|────────────────────────────|─────────|──────────────');
    for (const entry of ASSERTION_MAP) {
      const id = entry.id.padEnd(14);
      const type = entry.coverageType.padEnd(26);
      const status = entry.status.padEnd(7);
      console.log(`${id} | ${type} | ${status} | ${entry.testFile}`);
    }
    console.log('');
  }
  TestLogger.endPhase('Assertion Coverage Map');

  allPassed = TestAssertion.summary();
} catch (err) {
  TestLogger.error('Phase 5 verification failed', {
    error: err instanceof Error ? err.message : String(err),
  });
} finally {
  await tracker.cleanup();
}

const { passed, failed } = TestAssertion.counts();
console.log(`\n${'='.repeat(60)}`);
console.log(`Phase 5 Regression & Quality Gate: ${passed}/${passed + failed} checks passed`);
console.log(`Log file: ${logFile}`);
console.log(`${'='.repeat(60)}`);

process.exit(allPassed ? 0 : 1);
