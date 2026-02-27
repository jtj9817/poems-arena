#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 3: Source Attribution & Final UI Polishing
 * Track: Phase 6 — Frontend Integration
 * Generated: 2026-02-27
 * Purpose: Verify SourceInfo component, VerdictPopup integration,
 *          Foyer topicMeta.label display, mobile touch targets in TopicBar,
 *          and getDuelStats sourceInfo passthrough.
 *
 * Run with: bun scripts/verify-phase3-frontend-source-attribution.ts
 *
 * No live server required. File-content checks use Bun.file().text().
 * API client behaviour is verified by mocking globalThis.fetch.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { api } from '../apps/web/lib/api';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase3_source_attribution_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type CheckFn = () => void | Promise<void>;

function getAssertionFailureCount(): number {
  const state = TestAssertion as unknown as { failed?: number };
  return typeof state.failed === 'number' ? state.failed : 0;
}

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  TestLogger.startPhase(name);
  try {
    const failuresBefore = getAssertionFailureCount();
    await fn();
    const failuresAfter = getAssertionFailureCount();
    if (failuresAfter > failuresBefore) {
      TestLogger.error(`FAIL: ${name}`, { assertionFailures: failuresAfter - failuresBefore });
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
  return { exitCode: proc.exitCode ?? 1, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  TestEnvironment.guardProduction();
  TestEnvironment.displayInfo();

  TestLogger.info(
    '=== Starting Manual Test: Phase 3 — Source Attribution & Final UI Polishing ===',
    { testRunId, logFile },
  );

  let passed = 0;
  let failed = 0;

  function tally(result: boolean): void {
    if (result) passed++;
    else failed++;
  }

  // =========================================================================
  // SECTION A: File existence and export checks
  // =========================================================================

  TestLogger.info('--- Section A: File existence and exports ---');

  tally(
    await runCheck('A1: apps/web/components/SourceInfo.tsx exists', () => {
      TestAssertion.assertTrue(
        existsSync(path.join(repoRoot, 'apps/web/components/SourceInfo.tsx')),
        'SourceInfo.tsx must exist in apps/web/components/',
      );
    }),
  );

  tally(
    await runCheck('A2: SourceInfo.tsx exports the SourceInfo component', async () => {
      const source = await Bun.file(
        path.join(repoRoot, 'apps/web/components/SourceInfo.tsx'),
      ).text();
      TestAssertion.assertTrue(
        source.includes('export const SourceInfo'),
        'SourceInfo.tsx must export SourceInfo (export const SourceInfo)',
      );
      TestLogger.info('A2 export const SourceInfo found');
    }),
  );

  tally(
    await runCheck("A3: VerdictPopup.tsx imports SourceInfo from './SourceInfo'", async () => {
      const source = await Bun.file(
        path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx'),
      ).text();
      TestAssertion.assertTrue(
        source.includes("from './SourceInfo'"),
        "VerdictPopup.tsx must import from './SourceInfo'",
      );
      TestLogger.info("A3 import from './SourceInfo' confirmed in VerdictPopup");
    }),
  );

  tally(
    await runCheck('A4: Foyer.tsx uses featuredDuel.topicMeta.label', async () => {
      const source = await Bun.file(path.join(repoRoot, 'apps/web/pages/Foyer.tsx')).text();
      TestAssertion.assertTrue(
        source.includes('topicMeta.label'),
        'Foyer.tsx must reference featuredDuel.topicMeta.label',
      );
      TestLogger.info('A4 topicMeta.label reference confirmed in Foyer.tsx');
    }),
  );

  tally(
    await runCheck('A5: TopicBar.tsx has min-h-[44px] on chip buttons', async () => {
      const source = await Bun.file(path.join(repoRoot, 'apps/web/components/TopicBar.tsx')).text();
      TestAssertion.assertTrue(
        source.includes('min-h-[44px]'),
        'TopicBar.tsx chip buttons must include min-h-[44px] for 44px touch targets',
      );
      TestLogger.info('A5 min-h-[44px] touch target class confirmed in TopicBar');
    }),
  );

  // =========================================================================
  // SECTION B: SourceInfo component source code contracts
  // =========================================================================

  TestLogger.info('--- Section B: SourceInfo component logic ---');

  const sourceInfoSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/SourceInfo.tsx'),
  ).text();

  tally(
    await runCheck('B1: SourceInfo renders human attribution with "Written by" text', () => {
      TestAssertion.assertTrue(
        sourceInfoSource.includes('Written by'),
        'SourceInfo must include "Written by" text for human poem attribution',
      );
      TestLogger.info('B1 "Written by" attribution text confirmed in SourceInfo');
    }),
  );

  tally(
    await runCheck('B2: SourceInfo renders AI attribution with "Generated by" text', () => {
      TestAssertion.assertTrue(
        sourceInfoSource.includes('Generated by'),
        'SourceInfo must include "Generated by" text for AI poem attribution',
      );
      TestLogger.info('B2 "Generated by" attribution text confirmed in SourceInfo');
    }),
  );

  tally(
    await runCheck('B3: SourceInfo uses AuthorType from @sanctuary/shared', () => {
      TestAssertion.assertTrue(
        sourceInfoSource.includes('AuthorType'),
        'SourceInfo must import and use AuthorType from @sanctuary/shared',
      );
      TestAssertion.assertTrue(
        sourceInfoSource.includes('AuthorType.HUMAN'),
        'SourceInfo must compare type against AuthorType.HUMAN to branch human vs AI',
      );
      TestLogger.info('B3 AuthorType.HUMAN branch logic confirmed in SourceInfo');
    }),
  );

  // =========================================================================
  // SECTION C: VerdictPopup integration with SourceInfo
  // =========================================================================

  TestLogger.info('--- Section C: VerdictPopup SourceInfo integration ---');

  const verdictSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/VerdictPopup.tsx'),
  ).text();

  tally(
    await runCheck('C1: VerdictPopup renders SourceInfo for stats.duel.poemA', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemA.author'),
        'VerdictPopup must pass stats.duel.poemA.author to SourceInfo',
      );
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemA.type'),
        'VerdictPopup must pass stats.duel.poemA.type to SourceInfo',
      );
      TestLogger.info('C1 poemA author and type props confirmed in VerdictPopup');
    }),
  );

  tally(
    await runCheck('C2: VerdictPopup renders SourceInfo for stats.duel.poemB', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemB.author'),
        'VerdictPopup must pass stats.duel.poemB.author to SourceInfo',
      );
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemB.type'),
        'VerdictPopup must pass stats.duel.poemB.type to SourceInfo',
      );
      TestLogger.info('C2 poemB author and type props confirmed in VerdictPopup');
    }),
  );

  tally(
    await runCheck('C3: VerdictPopup passes sourceInfo prop to SourceInfo component', () => {
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemA.sourceInfo'),
        'VerdictPopup must pass stats.duel.poemA.sourceInfo as sourceInfo prop',
      );
      TestAssertion.assertTrue(
        verdictSource.includes('stats.duel.poemB.sourceInfo'),
        'VerdictPopup must pass stats.duel.poemB.sourceInfo as sourceInfo prop',
      );
      TestLogger.info('C3 sourceInfo prop passthrough confirmed for both poems in VerdictPopup');
    }),
  );

  // =========================================================================
  // SECTION D: API client — getDuelStats sourceInfo passthrough (mocked fetch)
  // =========================================================================

  TestLogger.info('--- Section D: api.getDuelStats sourceInfo passthrough ---');

  tally(
    await runCheck('D1: getDuelStats calls /duels/:id/stats endpoint', async () => {
      let capturedUrl = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: RequestInfo | URL, _init?: RequestInit) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            humanWinRate: 70,
            avgReadingTime: '3m 00s',
            duel: {
              id: 'duel-1',
              topic: 'Nature',
              poemA: { id: 'p1', title: 'T', content: 'C', author: 'Author', type: 'HUMAN' },
              poemB: { id: 'p2', title: 'T', content: 'C', author: 'AI', type: 'AI' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };
      try {
        await api.getDuelStats('duel-1');
        TestAssertion.assertTrue(
          capturedUrl.includes('/duels/duel-1/stats'),
          `getDuelStats must call /duels/duel-1/stats (got: ${capturedUrl})`,
        );
        TestLogger.info('D1 getDuelStats URL format verified', { capturedUrl });
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );

  tally(
    await runCheck(
      'D2: getDuelStats exposes sourceInfo.primary.source when present in response',
      async () => {
        const originalFetch = globalThis.fetch;
        const sourceInfoPayload = {
          primary: { source: 'poets.org', sourceUrl: 'https://poets.org/poem/test' },
          provenances: [
            {
              source: 'poets.org',
              sourceUrl: 'https://poets.org',
              scrapedAt: '2024-01-01',
              isPublicDomain: true,
            },
          ],
        };
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              humanWinRate: 55,
              avgReadingTime: '2m 10s',
              duel: {
                id: 'duel-2',
                topic: 'Love',
                poemA: {
                  id: 'p1',
                  title: 'My Title',
                  content: 'Content',
                  author: 'Emily Dickinson',
                  type: 'HUMAN',
                  year: '1890',
                  sourceInfo: sourceInfoPayload,
                },
                poemB: {
                  id: 'p2',
                  title: 'AI Title',
                  content: 'AI Content',
                  author: 'Claude 3 Opus',
                  type: 'AI',
                  sourceInfo: { primary: { source: null, sourceUrl: null }, provenances: [] },
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        try {
          const result = await api.getDuelStats('duel-2');
          TestAssertion.assertEquals(
            'poets.org',
            result.duel.poemA.sourceInfo?.primary.source ?? null,
            'poemA.sourceInfo.primary.source must be "poets.org"',
          );
          TestAssertion.assertEquals(
            1,
            result.duel.poemA.sourceInfo?.provenances.length ?? -1,
            'poemA.sourceInfo.provenances must have 1 entry',
          );
          TestAssertion.assertEquals(
            null,
            result.duel.poemB.sourceInfo?.primary.source ?? null,
            'poemB.sourceInfo.primary.source must be null (AI poem)',
          );
          TestAssertion.assertEquals(
            0,
            result.duel.poemB.sourceInfo?.provenances.length ?? -1,
            'poemB.sourceInfo.provenances must be empty for AI poem',
          );
          TestLogger.info('D2 sourceInfo passthrough verified', {
            poemASource: result.duel.poemA.sourceInfo?.primary.source,
            poemBSource: result.duel.poemB.sourceInfo?.primary.source,
          });
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    ),
  );

  tally(
    await runCheck(
      'D3: getDuelStats returns undefined sourceInfo when field is absent from response',
      async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              humanWinRate: 0,
              avgReadingTime: '1m 00s',
              duel: {
                id: 'duel-3',
                topic: 'Loss',
                poemA: { id: 'p1', title: 'T', content: 'C', author: 'A', type: 'HUMAN' },
                poemB: { id: 'p2', title: 'T', content: 'C', author: 'B', type: 'AI' },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        try {
          const result = await api.getDuelStats('duel-3');
          TestAssertion.assertTrue(
            result.duel.poemA.sourceInfo === undefined,
            'poemA.sourceInfo must be undefined when absent from response',
          );
          TestAssertion.assertTrue(
            result.duel.poemB.sourceInfo === undefined,
            'poemB.sourceInfo must be undefined when absent from response',
          );
          TestLogger.info('D3 absent sourceInfo returns undefined as expected');
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    ),
  );

  // =========================================================================
  // SECTION E: Foyer topicMeta migration
  // =========================================================================

  TestLogger.info('--- Section E: Foyer.tsx topicMeta.label migration ---');

  const foyerSource = await Bun.file(path.join(repoRoot, 'apps/web/pages/Foyer.tsx')).text();

  tally(
    await runCheck('E1: Foyer.tsx does NOT use raw featuredDuel.topic} (old pattern)', () => {
      const hasOldPattern = foyerSource.includes('featuredDuel.topic}');
      TestAssertion.assertTrue(
        !hasOldPattern,
        'Foyer.tsx must not use featuredDuel.topic} — should use topicMeta.label instead',
      );
      TestLogger.info('E1 old featuredDuel.topic} pattern is absent from Foyer.tsx');
    }),
  );

  tally(
    await runCheck('E2: Foyer.tsx uses featuredDuel.topicMeta.label (new pattern)', () => {
      TestAssertion.assertTrue(
        foyerSource.includes('featuredDuel.topicMeta.label'),
        'Foyer.tsx must use featuredDuel.topicMeta.label for canonical topic display',
      );
      TestLogger.info('E2 featuredDuel.topicMeta.label confirmed in Foyer.tsx');
    }),
  );

  // =========================================================================
  // SECTION F: Mobile touch target compliance
  // =========================================================================

  TestLogger.info('--- Section F: Mobile touch targets ---');

  const topicBarSource = await Bun.file(
    path.join(repoRoot, 'apps/web/components/TopicBar.tsx'),
  ).text();

  tally(
    await runCheck('F1: TopicBar.tsx chip buttons have min-h-[44px] for 44px touch targets', () => {
      const occurrences = (topicBarSource.match(/min-h-\[44px\]/g) ?? []).length;
      TestAssertion.assertTrue(
        occurrences >= 2,
        `TopicBar.tsx must have min-h-[44px] on at least 2 buttons (All + topic chips); found ${occurrences}`,
      );
      TestLogger.info('F1 min-h-[44px] touch target class count confirmed', { occurrences });
    }),
  );

  // =========================================================================
  // SECTION G: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section G: Automated test suite ---');

  tally(
    await runCheck('G1: pnpm --filter @sanctuary/web test exits 0 (33 tests)', async () => {
      const { exitCode, stdout, stderr } = await runCommand(
        ['pnpm', '--filter', '@sanctuary/web', 'test'],
        { env: { CI: 'true' } },
      );
      TestLogger.info('G1 test output', { exitCode, stdout: stdout.trim().slice(-800) });
      if (stderr.trim()) TestLogger.info('G1 stderr', { output: stderr.trim().slice(-400) });
      TestAssertion.assertEquals(0, exitCode, '@sanctuary/web test suite must exit 0');
    }),
  );

  tally(
    await runCheck(
      'G2: pnpm --filter @sanctuary/web build exits 0 (tsc + vite build)',
      async () => {
        const { exitCode, stdout, stderr } = await runCommand([
          'pnpm',
          '--filter',
          '@sanctuary/web',
          'build',
        ]);
        TestLogger.info('G2 build output', { exitCode, stdout: stdout.trim().slice(-600) });
        if (stderr.trim()) TestLogger.info('G2 stderr', { output: stderr.trim().slice(-400) });
        TestAssertion.assertEquals(0, exitCode, '@sanctuary/web build must exit 0 (tsc + vite)');
      },
    ),
  );

  // =========================================================================
  // Summary
  // =========================================================================

  const assertionsPassed = TestAssertion.summary();
  const checksPassed = failed === 0;
  const allPassed = assertionsPassed && checksPassed;
  const total = passed + failed;

  TestLogger.info('=== Manual Test Completed ===', { passed, failed, total });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Test ID  : ${testRunId}`);
  console.log(`  Checks   : ${passed}/${total} passed`);
  console.log(
    `  Result   : ${
      allPassed
        ? '✓ ALL PASSED'
        : `✗ ${failed} CHECKS FAILED${assertionsPassed ? '' : ' (assertions)'}`
    }`,
  );
  console.log(`  Logs     : ${logFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(allPassed ? 0 : 1);
}

await main();
