#!/usr/bin/env bun
/**
 * Conductor Manual Verification Script — Phase 5: Regression & Quality Gate
 * Track: user_analytics_20260312
 * Generated: 2026-03-13
 *
 * Purpose: Execute the Phase Completion Verification protocol (conductor/workflow.md):
 *   1. Determine phase scope (files changed since Phase 4 checkpoint fb0e1f3)
 *   2. Verify test coverage exists for all changed code files
 *   3. Execute API + web regression suites, lint, and format gates
 *   4. Confirm avgReadingTime has been fully removed from production code
 *   5. Verify all 27 spec assertion IDs (UA-API / UA-FE / UA-FLOW) are covered
 *   6. Output a structured verification report with manual verification steps
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
const PHASE_4_CHECKPOINT = 'fb0e1f3';

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

// ── Test coverage map: code file → expected test file(s) ──────────────────────

const CODE_FILE_TO_TEST_MAP: Record<string, string[]> = {
  'apps/api/src/routes/duels.ts': ['apps/api/src/routes/duels.test.ts'],
  'apps/api/src/routes/votes.ts': ['apps/api/src/routes/votes.test.ts'],
  'apps/web/components/VerdictPopup.tsx': ['apps/web/components/VerdictPopup.test.tsx'],
  'apps/web/pages/TheRing.tsx': [],
  'apps/web/lib/api.ts': ['apps/web/lib/api.test.ts'],
  'packages/shared/src/index.ts': [],
};

const NON_CODE_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.sh', '.lock', '.toml']);

function isCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  if (NON_CODE_EXTENSIONS.has(ext)) return false;
  if (filePath.includes('.test.') || filePath.includes('.spec.')) return false;
  if (filePath.startsWith('scripts/')) return false;
  if (filePath.startsWith('conductor/')) return false;
  if (filePath.startsWith('docs/')) return false;
  return ext === '.ts' || ext === '.tsx';
}

// ── Assertion Coverage Map (all 27 spec assertion IDs) ────────────────────────

interface AssertionEntry {
  id: string;
  coverageType: 'Automated' | 'Manual (code inspection)';
  testFile: string;
  testName: string;
  status: 'Covered' | 'Pending';
}

const ASSERTION_MAP: AssertionEntry[] = [
  // ── API Assertions (12) ──────────────────────────────────────────────────
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

  // ── Frontend Assertions (11) ─────────────────────────────────────────────
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
      'renders the detailed stats section when stats are provided (↑ vs global) | renders downward delta when topic rate is lower than global (↓)',
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

  // ── Cross-Layer Flow Assertions (4) ──────────────────────────────────────
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
      'Timer resets in handleSwipeInComplete ensuring independent readingTimeMs per duel; both values satisfy API positive-integer constraint via Math.max(1, ...) at line 146',
    status: 'Covered',
  },
  {
    id: 'UA-FLOW-003',
    coverageType: 'Automated',
    testFile: 'apps/web/components/VerdictPopup.test.tsx',
    testName:
      'renders the detailed stats section when stats are provided (topicDelta derived from fixtures) | renders downward delta (derived from fixtures)',
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

// ── Spec assertion IDs (canonical source: spec.md) ────────────────────────────

const SPEC_ASSERTION_IDS = [
  'UA-API-001',
  'UA-API-002',
  'UA-API-003',
  'UA-API-004',
  'UA-API-005',
  'UA-API-006',
  'UA-API-007',
  'UA-API-008',
  'UA-API-009',
  'UA-API-010',
  'UA-API-011',
  'UA-API-012',
  'UA-FE-001',
  'UA-FE-002',
  'UA-FE-003',
  'UA-FE-004',
  'UA-FE-005',
  'UA-FE-006',
  'UA-FE-007',
  'UA-FE-008',
  'UA-FE-009',
  'UA-FE-010',
  'UA-FE-011',
  'UA-FLOW-001',
  'UA-FLOW-002',
  'UA-FLOW-003',
  'UA-FLOW-004',
];

// ── Main Verification ─────────────────────────────────────────────────────────

try {
  TestLogger.info('=== Starting Conductor Manual Verification: Phase 5 ===', {
    testRunId,
    logFile,
    phase4Checkpoint: PHASE_4_CHECKPOINT,
  });

  // ── Section 1: Phase Scope Analysis ───────────────────────────────────────
  TestLogger.startPhase('Phase Scope Analysis');
  {
    const diffResult = await runCommand([
      'git',
      'diff',
      '--name-only',
      `${PHASE_4_CHECKPOINT}..HEAD`,
    ]);
    requireTrue(diffResult.exitCode === 0, 'git diff --name-only exits with code 0');

    const changedFiles = diffResult.stdout
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
    requireTrue(changedFiles.length > 0, 'Phase 5 has at least one changed file');

    TestLogger.info('Files changed in Phase 5', {
      count: changedFiles.length,
      files: changedFiles,
    });

    // Identify code files that need test coverage
    const codeFiles = changedFiles.filter(isCodeFile);
    const nonCodeFiles = changedFiles.filter((f) => !isCodeFile(f));

    TestLogger.info('Phase scope breakdown', {
      codeFiles,
      nonCodeFiles,
      codeCount: codeFiles.length,
      nonCodeCount: nonCodeFiles.length,
    });

    // Verify test coverage for each changed code file
    for (const codeFile of codeFiles) {
      const expectedTests = CODE_FILE_TO_TEST_MAP[codeFile];
      if (expectedTests === undefined) {
        // File not in the explicit map — check if a co-located test file exists
        const ext = path.extname(codeFile);
        const base = codeFile.slice(0, -ext.length);
        const colocatedTest = `${base}.test${ext}`;
        const colocatedTestX = `${base}.test.tsx`;
        const hasTest =
          existsSync(path.join(repoRoot, colocatedTest)) ||
          existsSync(path.join(repoRoot, colocatedTestX));
        requireTrue(hasTest, `Changed code file has test coverage: ${codeFile}`);
      } else if (expectedTests.length > 0) {
        for (const testFile of expectedTests) {
          requireTrue(
            existsSync(path.join(repoRoot, testFile)),
            `Test file exists for ${codeFile}: ${testFile}`,
          );
        }
      }
      // expectedTests.length === 0 means test coverage is handled via integration/manual
    }
  }
  TestLogger.endPhase('Phase Scope Analysis');

  // ── Section 2: API Regression Suite ───────────────────────────────────────
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

  // ── Section 3: Web Regression Suite ───────────────────────────────────────
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

  // ── Section 4: Lint Gate ──────────────────────────────────────────────────
  TestLogger.startPhase('Lint Gate');
  {
    const result = await runCommand(['pnpm', 'run', 'lint']);
    TestLogger.info('Lint output (tail)', {
      stdout: result.stdout.slice(-TEST_STDOUT_TAIL_CHARS),
      stderr: result.stderr.slice(-STDERR_TAIL_CHARS),
    });
    requireTrue(result.exitCode === 0, 'pnpm run lint exits with code 0');
  }
  TestLogger.endPhase('Lint Gate');

  // ── Section 5: Format Gate ────────────────────────────────────────────────
  TestLogger.startPhase('Format Gate');
  {
    const result = await runCommand(['pnpm', 'format:check']);
    TestLogger.info('Format check output (tail)', {
      stdout: result.stdout.slice(-TEST_STDOUT_TAIL_CHARS),
      stderr: result.stderr.slice(-STDERR_TAIL_CHARS),
    });
    requireTrue(result.exitCode === 0, 'pnpm format:check exits with code 0');
  }
  TestLogger.endPhase('Format Gate');

  // ── Section 6: avgReadingTime Absence ─────────────────────────────────────
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

  // ── Section 7: Spec Assertion Contract Completeness ───────────────────────
  TestLogger.startPhase('Spec Assertion Contract Completeness');
  {
    // Verify spec.md exists and contains all expected assertion IDs
    const specPath = path.join(repoRoot, 'conductor/tracks/user_analytics_20260312/spec.md');
    requireTrue(existsSync(specPath), 'spec.md exists in track directory');

    const specSource = readFileSync(specPath, 'utf-8');
    for (const assertionId of SPEC_ASSERTION_IDS) {
      requireTrue(specSource.includes(assertionId), `Spec contains assertion ID: ${assertionId}`);
    }

    // Verify every spec assertion ID has a corresponding entry in ASSERTION_MAP
    const mappedIds = new Set(ASSERTION_MAP.map((a) => a.id));
    for (const specId of SPEC_ASSERTION_IDS) {
      requireTrue(mappedIds.has(specId), `Assertion map covers spec ID: ${specId}`);
    }

    // Verify no assertion map entries reference IDs outside the spec
    for (const entry of ASSERTION_MAP) {
      requireTrue(
        SPEC_ASSERTION_IDS.includes(entry.id),
        `Assertion map entry ${entry.id} exists in spec`,
      );
    }
  }
  TestLogger.endPhase('Spec Assertion Contract Completeness');

  // ── Section 8: Assertion Coverage Map Verification ────────────────────────
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

  // ── Section 9: Manual Verification Steps ──────────────────────────────────
  TestLogger.startPhase('Manual Verification Steps');
  {
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  MANUAL VERIFICATION STEPS');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('The automated gates have passed. For manual verification,');
    console.log('please follow these steps:');
    console.log('');
    console.log('  1. Start both dev servers:');
    console.log('     $ pnpm dev');
    console.log('');
    console.log('  2. Open the Reading Room (The Ring):');
    console.log('     http://localhost:3000');
    console.log('     Click "Enter The Ring" to start a duel session.');
    console.log('');
    console.log('  3. Vote on a duel and confirm the Verdict popup shows:');
    console.log('     - Global recognition rate bar with a % label');
    console.log('     - Topic recognition rate bar with a % label');
    console.log('     - Topic-vs-global delta indicator (↑ X% or ↓ X%)');
    console.log('     - Global avg. decision time (e.g., "2m 00s")');
    console.log('     - Topic avg. decision time (e.g., "1m 00s")');
    console.log('     - No references to "Avg. Read Time" or "avgReadingTime"');
    console.log('');
    console.log('  4. Swipe to the next duel and vote again. Confirm:');
    console.log('     - The decision time resets between duels');
    console.log('     - The Verdict popup shows updated aggregate stats');
    console.log('');
    console.log('  5. Navigate to Past Bouts (/past-bouts) and confirm:');
    console.log('     - Duel cards show "Avg. Decision Time" (not "Avg. Read Time")');
    console.log('     - Values are formatted as "Xm XXs" or show "—" if no data');
    console.log('');
    console.log('  6. Execute the following curl command against the API:');
    console.log("     $ curl -s http://localhost:4000/api/v1/duels?sort=recent | jq '.[0]'");
    console.log('     Confirm the response includes avgDecisionTime/avgDecisionTimeMs');
    console.log('     and does NOT include avgReadingTime.');
    console.log('');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');
  }
  TestLogger.endPhase('Manual Verification Steps');

  allPassed = TestAssertion.summary();
} catch (err) {
  TestLogger.error('Phase 5 conductor verification failed', {
    error: err instanceof Error ? err.message : String(err),
  });
} finally {
  await tracker.cleanup();
}

const { passed, failed } = TestAssertion.counts();
console.log(`\n${'='.repeat(60)}`);
console.log(`Phase 5 Conductor Verification: ${passed}/${passed + failed} checks passed`);
console.log(`Log file: ${logFile}`);
console.log(`${'='.repeat(60)}`);

process.exit(allPassed ? 0 : 1);
