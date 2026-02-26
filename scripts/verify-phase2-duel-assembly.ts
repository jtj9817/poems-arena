#!/usr/bin/env bun
/**
 * Manual Test Script for Phase 2: Duel Assembly Logic
 * Generated: 2026-02-25
 * Purpose: Verify assemblePairs (pure function), DB integration via
 *          assembleAndPersistDuels, idempotency, many-duels-per-poem,
 *          and no-shared-topic behavior for Phase 5 — Duel Assembly & API Updates
 *
 * Run with: bun scripts/verify-phase2-duel-assembly.ts
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { TestAssertion, TestEnvironment, TestLogger } from './manual-test-helpers';
import { assemblePairs, assembleAndPersistDuels } from '../packages/ai-gen/src/duel-assembly';
import { createDb } from '../packages/db/src/client';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const testRunId = `phase2_duel_assembly_${new Date().toISOString().replace(/[:.]/g, '_')}`;
const repoRoot = path.resolve(import.meta.dir, '..');
const logFile = TestLogger.init(testRunId, path.join(repoRoot, 'logs', 'manual_tests'));

const tmpDir = process.env.TMPDIR ?? '/tmp';
const dbWorkDir = path.join(tmpDir, 'sanctuary_manual_tests');
const dbFile = path.join(dbWorkDir, `${testRunId}.sqlite`);
const dbUrl = process.env.LIBSQL_MANUAL_TEST_URL ?? `file:${dbFile}`;

// Short suffix for seeded entity IDs — avoids collision when running against
// an external (shared) database via LIBSQL_MANUAL_TEST_URL.
const shortId = testRunId.slice(-16).replace(/[^a-zA-Z0-9]/g, '');

// Unique IDs for all seeded entities
const TOPIC_NATURE_ID = `p2_nat_${shortId}`;
const TOPIC_LOVE_ID = `p2_lov_${shortId}`;
const HUMAN_A_ID = `p2_human_a_${shortId}`;
const AI_A_ID = `p2_ai_a_${shortId}`;
const AI_B_ID = `p2_ai_b_${shortId}`;
const HUMAN_X_ID = `p2_human_x_${shortId}`;
const AI_X_ID = `p2_ai_x_${shortId}`;

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

type LibsqlTx = {
  execute: (stmt: { sql: string; args?: unknown[] }) => Promise<{
    rows: Array<Array<unknown> | Record<string, unknown>>;
    rowsAffected?: number;
  }>;
  rollback(): Promise<void>;
};

let db: ReturnType<typeof createDb> | null = null;
let tx: LibsqlTx | null = null;
let cleanupDbFile: string | null = null;

type CheckFn = () => void | Promise<void>;

function getAssertionFailureCount(): number {
  const assertionState = TestAssertion as unknown as { failed?: number };
  return typeof assertionState.failed === 'number' ? assertionState.failed : 0;
}

async function runCheck(name: string, fn: CheckFn): Promise<boolean> {
  TestLogger.startPhase(name);
  try {
    const failuresBefore = getAssertionFailureCount();
    await fn();
    const failuresAfter = getAssertionFailureCount();
    if (failuresAfter > failuresBefore) {
      TestLogger.error(`FAIL: ${name}`, {
        assertionFailures: failuresAfter - failuresBefore,
      });
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

  TestLogger.info('=== Starting Manual Test: Phase 2 — Duel Assembly Logic ===', {
    testRunId,
    logFile,
    dbUrl,
  });

  let passed = 0;
  let failed = 0;

  function tally(result: boolean): void {
    if (result) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  // =========================================================================
  // SECTION A: File-system checks
  // =========================================================================

  TestLogger.info('--- Section A: Required files ---');

  tally(
    await runCheck('A1: duel-assembly.ts exists', () => {
      const p = path.join(repoRoot, 'packages/ai-gen/src/duel-assembly.ts');
      TestAssertion.assertTrue(existsSync(p), 'packages/ai-gen/src/duel-assembly.ts must exist');
    }),
  );

  tally(
    await runCheck('A2: duel-assembly.test.ts exists', () => {
      const p = path.join(repoRoot, 'packages/ai-gen/src/duel-assembly.test.ts');
      TestAssertion.assertTrue(
        existsSync(p),
        'packages/ai-gen/src/duel-assembly.test.ts must exist',
      );
    }),
  );

  tally(
    await runCheck('A3: assemblePairs is an exported function', () => {
      TestAssertion.assertTrue(
        typeof assemblePairs === 'function',
        'assemblePairs must be a function',
      );
      TestAssertion.assertTrue(
        typeof assembleAndPersistDuels === 'function',
        'assembleAndPersistDuels must be a function',
      );
    }),
  );

  // =========================================================================
  // SECTION B: Pure function — assemblePairs
  // =========================================================================

  TestLogger.info('--- Section B: assemblePairs pure function ---');

  const topicNature = { id: 'topic-nature', label: 'Nature' };
  const topicLove = { id: 'topic-love', label: 'Love' };

  tally(
    await runCheck('B1: basic pairing — 1 HUMAN + 1 AI with shared topic → 1 candidate', () => {
      const result = assemblePairs({
        humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
        aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicNature] }],
      });

      TestAssertion.assertCount(1, result, 'Expected exactly 1 duel candidate');
      TestAssertion.assertTrue(
        result[0]!.topicId === 'topic-nature',
        'Candidate must reference topic-nature',
      );
      TestAssertion.assertTrue(
        result[0]!.topic === 'Nature',
        'Candidate topic label must be "Nature"',
      );
      TestLogger.info('B1 candidate', {
        id: result[0]!.id,
        poemAId: result[0]!.poemAId,
        poemBId: result[0]!.poemBId,
        topic: result[0]!.topic,
        topicId: result[0]!.topicId,
      });
    }),
  );

  tally(
    await runCheck('B2: no shared topic → 0 candidates', () => {
      const result = assemblePairs({
        humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
        aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicLove] }],
      });
      TestAssertion.assertCount(0, result, 'Expected 0 candidates when topics differ');
    }),
  );

  tally(
    await runCheck(
      'B3: unordered pair uniqueness — (A,B) and (B,A) produce the same duel ID',
      () => {
        const [fwd] = assemblePairs({
          humanPoems: [{ id: 'human-x', type: 'HUMAN', topics: [topicNature] }],
          aiPoems: [{ id: 'ai-x', type: 'AI', topics: [topicNature] }],
        });
        // Reverse input order (treating ai-x as "human" type just for ID generation)
        const [rev] = assemblePairs({
          humanPoems: [{ id: 'ai-x', type: 'HUMAN', topics: [topicNature] }],
          aiPoems: [{ id: 'human-x', type: 'AI', topics: [topicNature] }],
        });

        TestAssertion.assertNotNull(fwd, 'Forward pair must produce a candidate');
        TestAssertion.assertNotNull(rev, 'Reverse pair must produce a candidate');
        TestAssertion.assertEquals(
          fwd!.id,
          rev!.id,
          '(A,B) and (B,A) must produce the same deterministic duel ID',
        );
        TestLogger.info('B3 duel IDs', { forward: fwd!.id, reverse: rev!.id });
      },
    ),
  );

  tally(
    await runCheck(
      'B4: many-duels-per-poem — 1 HUMAN + 3 AI poems with shared topic → 3 candidates',
      () => {
        const result = assemblePairs({
          humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
          aiPoems: [
            { id: 'ai-1', type: 'AI', topics: [topicNature] },
            { id: 'ai-2', type: 'AI', topics: [topicNature] },
            { id: 'ai-3', type: 'AI', topics: [topicNature] },
          ],
        });
        TestAssertion.assertCount(3, result, 'Expected 3 candidates (one per AI poem)');
        // All must reference human-1
        for (const duel of result) {
          TestAssertion.assertTrue(
            duel.poemAId === 'human-1' || duel.poemBId === 'human-1',
            `Duel ${duel.id} must include human-1`,
          );
        }
      },
    ),
  );

  tally(
    await runCheck('B5: fan-out cap — maxFanOut=2 limits candidates per HUMAN poem', () => {
      const aiPoems = ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5'].map((id) => ({
        id,
        type: 'AI' as const,
        topics: [topicNature],
      }));
      const result = assemblePairs({
        humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
        aiPoems,
        maxFanOut: 2,
      });
      TestAssertion.assertCount(2, result, 'maxFanOut=2 must yield exactly 2 candidates');
    }),
  );

  tally(
    await runCheck(
      'B6: fan-out determinism — same 2 AI poems chosen consistently by sorted ID',
      () => {
        // Unsorted input order: ai-z, ai-a, ai-m — sorted: ai-a, ai-m, ai-z
        const aiPoems = ['ai-z', 'ai-a', 'ai-m'].map((id) => ({
          id,
          type: 'AI' as const,
          topics: [topicNature],
        }));
        const result = assemblePairs({
          humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
          aiPoems,
          maxFanOut: 2,
        });
        TestAssertion.assertCount(2, result, 'Expected 2 candidates with maxFanOut=2');

        const pairedAiIds = result.map((d) =>
          d.poemAId.startsWith('ai-') ? d.poemAId : d.poemBId,
        );
        TestAssertion.assertTrue(
          pairedAiIds.includes('ai-a'),
          'ai-a (lexicographically first) must be included',
        );
        TestAssertion.assertTrue(
          pairedAiIds.includes('ai-m'),
          'ai-m (lexicographically second) must be included',
        );
        TestAssertion.assertTrue(
          !pairedAiIds.includes('ai-z'),
          'ai-z (lexicographically last) must be excluded by fan-out cap',
        );
        TestLogger.info('B6 paired AI poem IDs', { pairedAiIds });
      },
    ),
  );

  tally(
    await runCheck('B7: idempotency — pairs in existingDuelIds are skipped on rerun', () => {
      const [first] = assemblePairs({
        humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
        aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicNature] }],
      });

      TestAssertion.assertNotNull(first, 'First assembly must produce a candidate');

      const second = assemblePairs({
        humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
        aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicNature] }],
        existingDuelIds: new Set([first!.id]),
      });

      TestAssertion.assertCount(
        0,
        second,
        'Rerun with existingDuelIds must produce 0 new candidates',
      );
    }),
  );

  tally(
    await runCheck(
      'B8: position stability — A/B assignment is stable across independent calls',
      () => {
        const run1 = assemblePairs({
          humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
          aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicNature] }],
        });
        const run2 = assemblePairs({
          humanPoems: [{ id: 'human-1', type: 'HUMAN', topics: [topicNature] }],
          aiPoems: [{ id: 'ai-1', type: 'AI', topics: [topicNature] }],
        });

        TestAssertion.assertNotNull(run1[0], 'Run 1 must produce a candidate');
        TestAssertion.assertNotNull(run2[0], 'Run 2 must produce a candidate');
        TestAssertion.assertEquals(
          run1[0]!.poemAId,
          run2[0]!.poemAId,
          'poemAId must be identical across independent runs',
        );
        TestAssertion.assertEquals(
          run1[0]!.poemBId,
          run2[0]!.poemBId,
          'poemBId must be identical across independent runs',
        );
        TestLogger.info('B8 stable positions', {
          poemAId: run1[0]!.poemAId,
          poemBId: run1[0]!.poemBId,
        });
      },
    ),
  );

  // =========================================================================
  // SECTION C: Automated test suite
  // =========================================================================

  TestLogger.info('--- Section C: Automated test suite ---');

  tally(
    await runCheck('C1: @sanctuary/ai-gen test suite exits 0', async () => {
      const cmd = ['pnpm', '--filter', '@sanctuary/ai-gen', 'test'];
      TestLogger.info('Running command', { cmd: cmd.join(' ') });

      const result = await runCommand(cmd, { env: { CI: 'true' } });

      if (result.stdout.trim()) {
        TestLogger.info('stdout', { output: result.stdout.trim().slice(0, 800) });
      }
      if (result.stderr.trim()) {
        TestLogger.info('stderr', { output: result.stderr.trim().slice(0, 400) });
      }

      TestAssertion.assertEquals(0, result.exitCode, '@sanctuary/ai-gen test suite must pass');
    }),
  );

  // =========================================================================
  // SECTION D: Database integration — assembleAndPersistDuels
  // =========================================================================

  TestLogger.info('--- Section D: Database integration ---');

  tally(
    await runCheck('D1: create isolated manual-test database', async () => {
      mkdirSync(dbWorkDir, { recursive: true });

      if (!process.env.LIBSQL_MANUAL_TEST_URL) {
        cleanupDbFile = dbFile;
        const cmd = ['pnpm', '--filter', '@sanctuary/api', 'db:push'];
        TestLogger.info('Running db:push to create local schema', {
          cmd: cmd.join(' '),
          dbUrl,
        });

        const result = await runCommand(cmd, {
          env: {
            CI: 'true',
            LIBSQL_URL: dbUrl,
            LIBSQL_AUTH_TOKEN: process.env.LIBSQL_AUTH_TOKEN ?? '',
          },
        });

        if (result.stdout.trim()) {
          TestLogger.info('db:push stdout', { output: result.stdout.trim() });
        }
        if (result.stderr.trim()) {
          TestLogger.info('db:push stderr', { output: result.stderr.trim().slice(0, 400) });
        }

        TestAssertion.assertEquals(0, result.exitCode, 'db:push must exit 0');
      } else {
        TestLogger.info('Using external manual-test database', { dbUrl });
      }

      db = createDb({
        url: dbUrl,
        authToken: process.env.LIBSQL_AUTH_TOKEN,
      });
      TestLogger.info('Drizzle client created', { dbUrl });

      tx = (await db.$client.transaction('write')) as LibsqlTx;
      TestLogger.info('Write transaction started (rollback-only for all subsequent checks)');
    }),
  );

  tally(
    await runCheck('D2: seed base entities (topics, poems, poem_topics)', async () => {
      if (!tx) {
        throw new Error('Transaction not initialised — D1 must have passed first');
      }

      // Topics
      await tx.execute({
        sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
        args: [TOPIC_NATURE_ID, 'Nature'],
      });
      await tx.execute({
        sql: 'INSERT INTO topics (id, label) VALUES (?, ?)',
        args: [TOPIC_LOVE_ID, 'Love'],
      });

      // Poems
      const poems: Array<[string, string, string, string, string]> = [
        [
          HUMAN_A_ID,
          'Human Poem A',
          'Content for human poem A\nLine 2\nLine 3\nLine 4',
          'Poet A',
          'HUMAN',
        ],
        [AI_A_ID, 'AI Poem A', 'Content for ai poem A\nLine 2\nLine 3\nLine 4', 'Gemini', 'AI'],
        [AI_B_ID, 'AI Poem B', 'Content for ai poem B\nLine 2\nLine 3\nLine 4', 'Gemini', 'AI'],
        [
          HUMAN_X_ID,
          'Human Poem X',
          'Content for human poem X\nLine 2\nLine 3\nLine 4',
          'Poet X',
          'HUMAN',
        ],
        [AI_X_ID, 'AI Poem X', 'Content for ai poem X\nLine 2\nLine 3\nLine 4', 'Gemini', 'AI'],
      ];
      for (const [id, title, content, author, type] of poems) {
        await tx.execute({
          sql: 'INSERT INTO poems (id, title, content, author, type) VALUES (?, ?, ?, ?, ?)',
          args: [id, title, content, author, type],
        });
      }

      // poem_topics
      // human-A and ai-A share NATURE → will pair
      // ai-B also shares NATURE with human-A → many-duels test
      // human-X has LOVE only; ai-X has LOVE only → they share LOVE
      // We intentionally do NOT link human-X ↔ ai-A (no shared topic between X and A)
      const poemTopics: Array<[string, string]> = [
        [HUMAN_A_ID, TOPIC_NATURE_ID],
        [AI_A_ID, TOPIC_NATURE_ID],
        [AI_B_ID, TOPIC_NATURE_ID],
        [HUMAN_X_ID, TOPIC_LOVE_ID],
        [AI_X_ID, TOPIC_LOVE_ID],
      ];
      for (const [poemId, topicId] of poemTopics) {
        await tx.execute({
          sql: 'INSERT INTO poem_topics (poem_id, topic_id) VALUES (?, ?)',
          args: [poemId, topicId],
        });
      }

      TestLogger.info('Seeded topics, poems, and poem_topics', {
        topics: [TOPIC_NATURE_ID, TOPIC_LOVE_ID],
        poems: poems.map(([id]) => id),
      });
      TestAssertion.assertTrue(true, 'Seed data inserted without errors');
    }),
  );

  // Shared persistence adapter for all DB checks — routes through the rollback-only tx.
  const persistenceDb = {
    execute: async (query: string, params?: unknown[]) => {
      if (!tx) throw new Error('Transaction not available');
      const result = await tx.execute({ sql: query, args: params ?? [] });
      // LibSQL tx.execute returns rows as arrays; normalise to Record<string, unknown>
      const rows = (result.rows as Array<unknown>).map((row) => {
        if (Array.isArray(row)) {
          // Shouldn't normally happen via execute(), but handle defensively
          return row as unknown as Record<string, unknown>;
        }
        return row as Record<string, unknown>;
      });
      return { rows, rowsAffected: result.rowsAffected };
    },
  };

  tally(
    await runCheck(
      'D3: basic pairing — assembleAndPersistDuels creates all 3 expected seeded duels',
      async () => {
        if (!tx) throw new Error('Skipped — D1 did not complete');

        const expectedDuelCount = 3;
        const { totalCandidates, newDuels } = await assembleAndPersistDuels(persistenceDb);

        TestLogger.info('D3 assembly result', { totalCandidates, newDuels });
        TestAssertion.assertEquals(
          expectedDuelCount,
          totalCandidates,
          `Expected ${expectedDuelCount} candidates (human-A↔ai-A + human-A↔ai-B + human-X↔ai-X), got ${totalCandidates}`,
        );
        TestAssertion.assertEquals(
          expectedDuelCount,
          newDuels,
          `Expected ${expectedDuelCount} new duel rows on first run, got ${newDuels}`,
        );

        // Verify rows exist in DB
        const countResult = await tx.execute({
          sql: 'SELECT COUNT(*) AS cnt FROM duels',
          args: [],
        });
        const dbCount = Number((countResult.rows[0] as Record<string, unknown>).cnt ?? 0);
        TestAssertion.assertEquals(
          expectedDuelCount,
          dbCount,
          `duels table must contain exactly ${expectedDuelCount} rows after first assembly run, got ${dbCount}`,
        );
        TestLogger.info('D3 duels in DB', { count: dbCount });
      },
    ),
  );

  tally(
    await runCheck(
      'D4: idempotency — rerunning assembleAndPersistDuels inserts no duplicate duels',
      async () => {
        if (!tx) throw new Error('Skipped — D1 did not complete');

        const before = await tx.execute({ sql: 'SELECT COUNT(*) AS cnt FROM duels', args: [] });
        const countBefore = Number((before.rows[0] as Record<string, unknown>).cnt ?? 0);

        const { newDuels } = await assembleAndPersistDuels(persistenceDb);

        const after = await tx.execute({ sql: 'SELECT COUNT(*) AS cnt FROM duels', args: [] });
        const countAfter = Number((after.rows[0] as Record<string, unknown>).cnt ?? 0);

        TestLogger.info('D4 idempotency', { countBefore, newDuels, countAfter });

        TestAssertion.assertEquals(
          0,
          newDuels,
          'Rerun must report 0 new duels (INSERT OR IGNORE skips all existing pairs)',
        );
        TestAssertion.assertEquals(
          countBefore,
          countAfter,
          'Total duel count in DB must not change on rerun',
        );
      },
    ),
  );

  tally(
    await runCheck(
      'D5: duel rows contain correct poem_a_id/poem_b_id and topic references',
      async () => {
        if (!tx) throw new Error('Skipped — D1 did not complete');

        // Query the duel that was created for human-A ↔ ai-A
        const rows = await tx.execute({
          sql: `SELECT id, poem_a_id, poem_b_id, topic_id, topic
              FROM duels
              WHERE (poem_a_id IN (?, ?) AND poem_b_id IN (?, ?))
              LIMIT 1`,
          args: [HUMAN_A_ID, AI_A_ID, HUMAN_A_ID, AI_A_ID],
        });

        TestAssertion.assertTrue(
          rows.rows.length >= 1,
          'Expected at least 1 duel for human-A ↔ ai-A',
        );

        const duel = rows.rows[0] as Record<string, unknown>;
        const poemAId = String(duel.poem_a_id ?? '');
        const poemBId = String(duel.poem_b_id ?? '');
        const topicId = String(duel.topic_id ?? '');
        const topic = String(duel.topic ?? '');

        TestAssertion.assertTrue(
          (poemAId === HUMAN_A_ID && poemBId === AI_A_ID) ||
            (poemAId === AI_A_ID && poemBId === HUMAN_A_ID),
          'Duel must reference human-A and ai-A as poem_a and poem_b (either order)',
        );
        TestAssertion.assertEquals(
          TOPIC_NATURE_ID,
          topicId,
          'Duel topic_id must match the seeded NATURE topic ID',
        );
        TestAssertion.assertEquals('Nature', topic, 'Duel topic label must be "Nature"');
        TestLogger.info('D5 duel row', { id: String(duel.id), poemAId, poemBId, topicId, topic });
      },
    ),
  );

  tally(
    await runCheck(
      'D6: deterministic duel ID — DB row ID matches pure-function output',
      async () => {
        if (!tx) throw new Error('Skipped — D1 did not complete');

        // Compute expected duel ID using assemblePairs (same hash logic as duel-assembly.ts)
        const [expected] = assemblePairs({
          humanPoems: [
            { id: HUMAN_A_ID, type: 'HUMAN', topics: [{ id: TOPIC_NATURE_ID, label: 'Nature' }] },
          ],
          aiPoems: [
            { id: AI_A_ID, type: 'AI', topics: [{ id: TOPIC_NATURE_ID, label: 'Nature' }] },
          ],
        });

        TestAssertion.assertNotNull(
          expected,
          'Pure function must yield a candidate for human-A ↔ ai-A',
        );

        const rows = await tx.execute({
          sql: `SELECT id FROM duels WHERE id = ?`,
          args: [expected!.id],
        });

        TestLogger.info('D6 deterministic ID check', {
          expectedId: expected!.id,
          foundInDb: rows.rows.length > 0,
        });
        TestAssertion.assertTrue(
          rows.rows.length === 1,
          `Duel with deterministic ID "${expected!.id}" must exist in the DB`,
        );
      },
    ),
  );

  tally(
    await runCheck('D7: no-shared-topic pair — human-X ↔ ai-A produces no duel', async () => {
      if (!tx) throw new Error('Skipped — D1 did not complete');

      // human-X has only LOVE; ai-A has only NATURE — no shared topic.
      // The overall assembly has already run in D3; verify no duel exists for this pair.
      const rows = await tx.execute({
        sql: `SELECT id FROM duels
              WHERE (poem_a_id = ? AND poem_b_id = ?)
                 OR (poem_a_id = ? AND poem_b_id = ?)`,
        args: [HUMAN_X_ID, AI_A_ID, AI_A_ID, HUMAN_X_ID],
      });

      TestLogger.info('D7 no-shared-topic check', { rowsFound: rows.rows.length });
      TestAssertion.assertCount(
        0,
        rows.rows,
        'No duel must exist for human-X ↔ ai-A (no shared topic)',
      );
    }),
  );

  // =========================================================================
  // Summary
  // =========================================================================

  TestLogger.info('=== Manual Test Completed ===', {
    passed,
    failed,
    logFile,
  });

  const allPassed = TestAssertion.summary();
  if (!allPassed || failed > 0) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

void (async () => {
  try {
    await main();
  } catch (error) {
    TestLogger.error('Fatal error in Phase 2 manual verification script', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
    });
    process.exitCode = 1;
  }
})().finally(async () => {
  // Always rollback — test data must never persist.
  try {
    if (tx) {
      await tx.rollback();
      TestLogger.info('Write transaction rolled back — no test data persisted');
    }
  } catch (error) {
    TestLogger.error('Failed to rollback transaction', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    if (db) {
      await db.$client.close();
      TestLogger.info('LibSQL client closed');
    }
  } catch (error) {
    TestLogger.error('Failed to close LibSQL client', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  // Remove temp SQLite file unless the user wants to inspect it.
  try {
    if (process.env.LIBSQL_MANUAL_TEST_URL) {
      TestLogger.info('External database used — no local file cleanup needed');
      return;
    }
    if (!cleanupDbFile) return;
    if (process.env.MANUAL_TEST_KEEP_DB === '1') {
      TestLogger.info('Keeping local database file (MANUAL_TEST_KEEP_DB=1)', {
        dbFile: cleanupDbFile,
      });
      return;
    }
    rmSync(cleanupDbFile, { force: true });
    TestLogger.info('Removed local manual-test database file', { dbFile: cleanupDbFile });
  } catch (error) {
    TestLogger.error('Failed to remove local database file', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
