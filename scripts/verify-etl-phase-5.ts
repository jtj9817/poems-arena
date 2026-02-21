#!/usr/bin/env bun
/**
 * Phase 5 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Verifies Stage 4 — Load (04-load.ts) + CLI Orchestration:
 *   Check 1:  ETL automated test suite passes
 *   Check 2:  Deterministic ID generation — stable, case/whitespace-insensitive
 *   Check 3:  upsertTopics writes all 20 canonical topics with correct labels
 *   Check 4:  loadPoem writes poem + poem_topics (delete+insert) + scrape_sources in transaction
 *   Check 5:  runLoadStage reads 03-tag NDJSON and loads poems to mock DB
 *   Check 6:  Public-domain filtering — non-PD poems excluded by default
 *   Check 7:  --include-non-pd flag overrides PD filter (all poems loaded)
 *   Check 8:  Dry-run mode: poems counted but no DB writes (loaded>0, txCalls=0)
 *   Check 9:  CLI arg parsing — --stage load, --stage all, --include-non-pd, --dry-run, --limit
 *   Check 10: @sanctuary/etl typecheck passes
 *
 * Usage:
 *   bun scripts/verify-etl-phase-5.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

import { generatePoemId, generateScrapeSourceId } from '../packages/etl/src/utils/id-gen';
import { CANONICAL_TOPICS, TOPIC_LABELS } from '../packages/etl/src/mappings/theme-to-topic';
import { parseCliArgs } from '../packages/etl/src/index';

// ── Terminal colours ──────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

const ICON_PASS = `${GREEN}${BOLD}✓ PASS${RESET}`;
const ICON_FAIL = `${RED}${BOLD}✗ FAIL${RESET}`;
const ICON_SKIP = `${YELLOW}${BOLD}⊘ SKIP${RESET}`;

// ── Path constants ────────────────────────────────────────────────────────────

// Script lives at: scripts/verify-etl-phase-5.ts
// Repo root is one level up.
const REPO_ROOT = path.resolve(import.meta.dir, '..');

// ── Logging helpers ───────────────────────────────────────────────────────────

function section(title: string) {
  const bar = '─'.repeat(60);
  console.log(`\n${CYAN}${BOLD}${bar}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}${bar}${RESET}`);
}

function info(msg: string) {
  console.log(`  ${DIM}ℹ ${msg}${RESET}`);
}

function cmd(command: string) {
  console.log(`  ${BLUE}${DIM}$ ${command}${RESET}`);
}

function blockOutput(label: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const lines = trimmed.split('\n');
  for (const line of lines) {
    console.log(`  ${DIM}${label}${RESET} ${line}`);
  }
}

// ── Subprocess helpers ────────────────────────────────────────────────────────

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

async function run(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SpawnResult> {
  const { cwd = REPO_ROOT, timeoutMs } = opts;

  const proc = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      info(`Process timed out after ${timeoutMs}ms — killing.`);
      proc.kill();
    }, timeoutMs);
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited.catch(() => {});
  clearTimeout(timer);

  const exitCode = proc.exitCode ?? 1;
  return { exitCode, stdout, stderr, combined: stdout + '\n' + stderr };
}

// ── Check runner ──────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'skip';

interface CheckResult {
  id: number;
  name: string;
  status: CheckStatus;
  output: string;
  expected?: string;
  notes?: string;
}

const results: CheckResult[] = [];
let checkId = 0;

async function check(
  name: string,
  fn: () => Promise<Omit<CheckResult, 'id' | 'name'>>,
): Promise<void> {
  checkId++;
  const id = checkId;
  console.log(`\n${BOLD}Check ${id}: ${name}${RESET}`);

  let result: CheckResult;
  try {
    const r = await fn();
    result = { id, name, ...r };
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    result = {
      id,
      name,
      status: 'fail',
      output: errMsg,
      notes: 'Unhandled exception in check function',
    };
  }

  results.push(result);

  const icon =
    result.status === 'pass' ? ICON_PASS : result.status === 'skip' ? ICON_SKIP : ICON_FAIL;

  console.log(`  Status: ${icon}`);
  if (result.output) blockOutput('out ›', result.output);
  if (result.expected) info(`Expected: ${result.expected}`);
  if (result.notes) info(`Note: ${result.notes}`);
}

// ── Temp directory helpers ────────────────────────────────────────────────────

const tempDirs: string[] = [];

/**
 * Creates a work dir with the 03-tag sub-directory already in place
 * (so the load stage can glob for NDJSON files inside it).
 */
async function makeLoadDirs(): Promise<{ workDir: string; tagDir: string }> {
  const prefix = join(os.tmpdir(), 'etl-verify-phase5-');
  const workDir = await mkdtemp(prefix + 'work-');
  const tagDir = join(workDir, '03-tag');
  await mkdir(tagDir, { recursive: true });
  tempDirs.push(workDir);
  return { workDir, tagDir };
}

async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
}

// ── Mock DB factory ───────────────────────────────────────────────────────────
//
// Mirrors the mock used in 04-load.test.ts so we can run load-stage functions
// in-process without a real Turso database. Drizzle table objects carry their
// name under Symbol.for('drizzle:Name'), which this mock reads to identify
// which table is being targeted.

const DRIZZLE_NAME = Symbol.for('drizzle:Name');

interface MockCall {
  op: 'insert' | 'delete' | 'transaction';
  table?: string;
  values?: Record<string, unknown>;
  conflict?: string;
  where?: string;
}

function resolveTableName(table: unknown): string {
  if (table && typeof table === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (table as any)[DRIZZLE_NAME];
    if (typeof name === 'string') return name;
  }
  return 'unknown';
}

function createMockDb() {
  const calls: MockCall[] = [];

  /** Chainable insert builder that records values and conflict strategy. */
  function makeInsertChain(tableName: string) {
    let insertValues: Record<string, unknown> = {};
    const chain = {
      values(vals: Record<string, unknown>) {
        insertValues = vals;
        return chain;
      },
      onConflictDoUpdate(_opts: { target: unknown; set: Record<string, unknown> }) {
        calls.push({
          op: 'insert',
          table: tableName,
          values: insertValues,
          conflict: 'doUpdate',
        });
        return chain;
      },
      // Thenable: handles `await insert(...).values(...)` without onConflict
      then(resolve: (v?: unknown) => void) {
        if (!calls.find((c) => c.values === insertValues)) {
          calls.push({ op: 'insert', table: tableName, values: insertValues });
        }
        resolve();
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chain as any)[Symbol.toStringTag] = 'Promise';
    return chain;
  }

  const db = {
    insert(table: unknown) {
      return makeInsertChain(resolveTableName(table));
    },
    delete(table: unknown) {
      const tableName = resolveTableName(table);
      return {
        where(_condition: unknown) {
          calls.push({ op: 'delete', table: tableName, where: 'condition' });
          return Promise.resolve();
        },
      };
    },
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      calls.push({ op: 'transaction' });
      const tx = { insert: db.insert.bind(db), delete: db.delete.bind(db) };
      await fn(tx);
    },
    _calls: calls,
  };

  return db;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

type SourceName = 'poets.org' | 'poetry-foundation' | 'loc-180' | 'gutenberg';

function makeProv(id: string, source: SourceName, url: string, isPublicDomain = true) {
  return {
    sourceId: id,
    source,
    sourceUrl: url,
    isPublicDomain,
    scrapedAt: '2026-02-01T10:00:00.000Z',
  };
}

/** Base TagPoem — public domain, poets.org. */
function makeTagPoem(overrides: Record<string, unknown> = {}) {
  return {
    title: 'The Raven',
    author: 'Edgar Allan Poe',
    year: '1845',
    content:
      'Once upon a midnight dreary\nWhile I pondered weak and weary\nOver many a quaint\nAnd curious volume of forgotten lore',
    themes: ['death', 'grief'],
    form: 'trochaic octameter',
    topics: ['mortality', 'grief'],
    provenances: [makeProv('src-raven-001', 'poets.org', 'https://poets.org/poem/raven')],
    ...overrides,
  };
}

/** PD poem A — Robert Frost, nature topic. */
const POEM_A = makeTagPoem({
  title: 'The Road Not Taken',
  author: 'Robert Frost',
  year: '1916',
  content:
    'Two roads diverged in a yellow wood\nAnd sorry I could not travel both\nAnd be one traveler long I stood\nAnd looked down one as far as I could',
  themes: ['nature', 'choices'],
  topics: ['nature'],
  provenances: [makeProv('src-road-001', 'gutenberg', 'https://gutenberg.org/poem/road')],
});

/** PD poem B — Shakespeare, love topic. */
const POEM_B = makeTagPoem({
  title: 'Sonnet 18',
  author: 'William Shakespeare',
  year: '1609',
  content:
    'Shall I compare thee to a summers day\nThou art more lovely and more temperate\nRough winds do shake the darling buds of May\nAnd summers lease hath all too short a date',
  themes: ['love', 'beauty'],
  topics: ['love'],
  provenances: [
    makeProv('src-son18-001', 'poetry-foundation', 'https://poetry-foundation.org/poem/sonnet18'),
  ],
});

/** Non-PD poem — single provenance with isPublicDomain=false. */
const POEM_NON_PD = makeTagPoem({
  title: 'A Modern Copyrighted Poem',
  author: 'Contemporary Author',
  year: '2020',
  content:
    'This poem is protected by copyright law\nAnd should not appear in the database\nUnless the --include-non-pd flag is used\nTo override the default filter behavior',
  themes: ['modernity'],
  topics: ['nature'],
  provenances: [makeProv('src-nonpd-001', 'poets.org', 'https://poets.org/poem/modern', false)],
});

// ── Check 1: Automated tests ──────────────────────────────────────────────────

async function check1_automatedTests() {
  await check('ETL automated test suite passes (pnpm --filter @sanctuary/etl test)', async () => {
    const command = 'pnpm --filter @sanctuary/etl test';
    cmd(command);

    const result = await run(['pnpm', '--filter', '@sanctuary/etl', 'test'], {
      timeoutMs: 120_000,
    });

    blockOutput('stdout ›', result.stdout);
    blockOutput('stderr ›', result.stderr);

    if (result.exitCode !== 0) {
      return {
        status: 'fail',
        output: result.combined.trim(),
        expected: 'All tests pass (exit code 0)',
        notes: `Process exited with code ${result.exitCode}`,
      };
    }

    const combined = result.combined;
    const passMatch = combined.match(/(\d+)\s+pass/i);
    const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;

    return {
      status: 'pass',
      output: `${passCount} tests passed`,
      notes: passMatch ? undefined : 'Could not parse pass count from output',
    };
  });
}

// ── Check 2: Deterministic ID generation ─────────────────────────────────────

async function check2_deterministicIds() {
  await check(
    'Deterministic ID generation: stable, case-insensitive, whitespace-insensitive',
    async () => {
      // generatePoemId stability
      const id1 = generatePoemId('The Raven', 'Edgar Allan Poe');
      const id2 = generatePoemId('The Raven', 'Edgar Allan Poe');
      if (id1 !== id2) {
        return {
          status: 'fail',
          output: `id1=${id1}, id2=${id2}`,
          expected: 'Identical inputs produce identical poem IDs',
        };
      }
      info(`Stable poem ID: ${id1}`);

      // Case-insensitivity
      const idUpper = generatePoemId('THE RAVEN', 'EDGAR ALLAN POE');
      const idLower = generatePoemId('the raven', 'edgar allan poe');
      if (idUpper !== id1 || idLower !== id1) {
        return {
          status: 'fail',
          output: `upper=${idUpper}, lower=${idLower}, mixed=${id1}`,
          expected: 'All three casings produce the same poem ID',
        };
      }
      info('Case-insensitive: ✓');

      // Whitespace-insensitivity
      const idPadded = generatePoemId('  The   Raven  ', '  Edgar   Allan   Poe  ');
      if (idPadded !== id1) {
        return {
          status: 'fail',
          output: `padded=${idPadded}, normal=${id1}`,
          expected: 'Extra whitespace does not change the poem ID',
        };
      }
      info('Whitespace-insensitive: ✓');

      // Uniqueness across different inputs
      const idOther = generatePoemId('Annabel Lee', 'Edgar Allan Poe');
      if (idOther === id1) {
        return {
          status: 'fail',
          output: `Collision: "${id1}" for both "The Raven" and "Annabel Lee"`,
          expected: 'Different poem titles produce different IDs',
        };
      }
      info('Title uniqueness: ✓');

      const idOtherAuthor = generatePoemId('The Raven', 'Different Author');
      if (idOtherAuthor === id1) {
        return {
          status: 'fail',
          output: `Collision: "${id1}" for same title, different author`,
          expected: 'Different authors produce different IDs',
        };
      }
      info('Author uniqueness: ✓');

      // ID format: 12 lowercase hex chars
      if (id1.length !== 12 || !/^[0-9a-f]+$/.test(id1)) {
        return {
          status: 'fail',
          output: `id="${id1}" length=${id1.length}`,
          expected: '12 lowercase hex characters',
        };
      }
      info('ID format (12-char hex): ✓');

      // generateScrapeSourceId stability
      const srcId1 = generateScrapeSourceId(id1, 'poets.org', 'https://poets.org/poem/raven');
      const srcId2 = generateScrapeSourceId(id1, 'poets.org', 'https://poets.org/poem/raven');
      if (srcId1 !== srcId2) {
        return {
          status: 'fail',
          output: `srcId1=${srcId1}, srcId2=${srcId2}`,
          expected: 'Same scrape-source inputs produce the same scrape source ID',
        };
      }
      info(`Stable scrape source ID: ${srcId1}`);

      // Scrape source uniqueness
      const srcIdDiff = generateScrapeSourceId(id1, 'gutenberg', 'https://gutenberg.org/raven');
      if (srcIdDiff === srcId1) {
        return {
          status: 'fail',
          output: `Collision: "${srcId1}" for different source+url`,
          expected: 'Different source/URL produce different scrape source IDs',
        };
      }
      info('Scrape source uniqueness: ✓');

      return {
        status: 'pass',
        output: `poemId=${id1}; scrapeSourceId=${srcId1}; all stability/uniqueness checks pass`,
      };
    },
  );
}

// ── Check 3: upsertTopics with mock DB ────────────────────────────────────────

async function check3_upsertTopics() {
  await check(
    'upsertTopics: all 20 canonical topics upserted with correct labels (onConflictDoUpdate)',
    async () => {
      const { upsertTopics } = await import('../packages/etl/src/stages/04-load');
      const db = createMockDb();

      const count = await upsertTopics(db as never);

      if (count !== 20) {
        return {
          status: 'fail',
          output: `Returned count=${count}`,
          expected: 'count=20',
        };
      }
      info(`upsertTopics returned count=${count}`);

      const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'topics');
      if (topicInserts.length !== 20) {
        return {
          status: 'fail',
          output: `topic inserts in DB=${topicInserts.length}`,
          expected: '20 inserts into the topics table',
        };
      }
      info(`${topicInserts.length} rows inserted into topics ✓`);

      // All inserts must use onConflictDoUpdate (idempotency guarantee)
      const nonUpsert = topicInserts.filter((c) => c.conflict !== 'doUpdate');
      if (nonUpsert.length > 0) {
        return {
          status: 'fail',
          output: `${nonUpsert.length} inserts missing onConflictDoUpdate`,
          expected: 'All topic inserts use onConflictDoUpdate',
        };
      }
      info('All use onConflictDoUpdate ✓');

      // Every canonical topic ID must appear exactly once
      const insertedIds = new Set(topicInserts.map((c) => c.values?.id as string));
      const missingTopics = CANONICAL_TOPICS.filter((t) => !insertedIds.has(t));
      if (missingTopics.length > 0) {
        return {
          status: 'fail',
          output: `Missing canonical topics: ${missingTopics.join(', ')}`,
          expected: 'All 20 CANONICAL_TOPICS represented',
        };
      }
      info('All 20 canonical topic IDs present ✓');

      // Each label must match TOPIC_LABELS
      const labelMismatches: string[] = [];
      for (const call of topicInserts) {
        const id = call.values?.id as string;
        const label = call.values?.label as string;
        const expected = TOPIC_LABELS[id as keyof typeof TOPIC_LABELS];
        if (label !== expected) {
          labelMismatches.push(`"${id}": got "${label}", expected "${expected}"`);
        }
      }
      if (labelMismatches.length > 0) {
        return {
          status: 'fail',
          output: labelMismatches.join('\n'),
          expected: 'Each topic uses the correct display label from TOPIC_LABELS',
        };
      }
      info('All labels correct ✓');

      return {
        status: 'pass',
        output: `count=20; all 20 topics inserted with correct labels and onConflictDoUpdate`,
      };
    },
  );
}

// ── Check 4: loadPoem with mock DB ────────────────────────────────────────────

async function check4_loadPoem() {
  await check(
    'loadPoem: upserts poem (type=HUMAN) + poem_topics (delete+insert) + scrape_sources in transaction',
    async () => {
      const { loadPoem } = await import('../packages/etl/src/stages/04-load');
      const db = createMockDb();

      const poem = makeTagPoem({
        topics: ['mortality', 'grief'],
        provenances: [
          makeProv('src-raven-p1', 'poets.org', 'https://poets.org/poem/raven'),
          makeProv('src-raven-g1', 'gutenberg', 'https://gutenberg.org/poem/raven'),
        ],
      });

      const returnedId = await loadPoem(db as never, poem as never);

      // Transaction check
      const txCalls = db._calls.filter((c) => c.op === 'transaction');
      if (txCalls.length !== 1) {
        return {
          status: 'fail',
          output: `transaction calls=${txCalls.length}`,
          expected: 'Exactly 1 transaction wrapping all poem writes',
        };
      }
      info('Transaction used ✓');

      // Poem upsert
      const poemInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poems');
      if (poemInserts.length !== 1) {
        return {
          status: 'fail',
          output: `poem inserts=${poemInserts.length}`,
          expected: '1 poem upsert',
        };
      }
      const poemInsert = poemInserts[0];

      if (poemInsert.values?.type !== 'HUMAN') {
        return {
          status: 'fail',
          output: `type=${poemInsert.values?.type}`,
          expected: 'type=HUMAN',
        };
      }
      if (poemInsert.conflict !== 'doUpdate') {
        return {
          status: 'fail',
          output: `conflict=${poemInsert.conflict}`,
          expected: 'onConflictDoUpdate for idempotent poem upsert',
        };
      }

      const expectedPoemId = generatePoemId(poem.title as string, poem.author as string);
      if (poemInsert.values?.id !== expectedPoemId || returnedId !== expectedPoemId) {
        return {
          status: 'fail',
          output: `inserted id=${poemInsert.values?.id}, returned id=${returnedId}, expected=${expectedPoemId}`,
          expected: 'Deterministic poem ID from generatePoemId(title, author)',
        };
      }
      info(`Poem upsert: id=${expectedPoemId}, type=HUMAN, onConflictDoUpdate ✓`);

      // poem_topics: delete then insert
      const deleteOp = db._calls.find((c) => c.op === 'delete' && c.table === 'poem_topics');
      if (!deleteOp) {
        return {
          status: 'fail',
          output: 'No delete on poem_topics',
          expected: 'Delete existing poem_topics before inserting new associations',
        };
      }
      const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poem_topics');
      if (topicInserts.length !== 2) {
        return {
          status: 'fail',
          output: `poem_topics inserts=${topicInserts.length}`,
          expected: '2 poem_topics inserts (one per topic in [mortality, grief])',
        };
      }

      // Verify delete comes before inserts in the call log
      const deleteIdx = db._calls.indexOf(deleteOp);
      const firstTopicInsertIdx = db._calls.indexOf(topicInserts[0]);
      if (deleteIdx > firstTopicInsertIdx) {
        return {
          status: 'fail',
          output: `delete at index ${deleteIdx}, first topic insert at ${firstTopicInsertIdx}`,
          expected: 'delete must precede topic inserts',
        };
      }
      info('poem_topics: delete + 2 inserts (delete-first order) ✓');

      // scrape_sources: one per provenance, all onConflictDoUpdate
      const sourceInserts = db._calls.filter(
        (c) => c.op === 'insert' && c.table === 'scrape_sources',
      );
      if (sourceInserts.length !== 2) {
        return {
          status: 'fail',
          output: `scrape_sources inserts=${sourceInserts.length}`,
          expected: '2 scrape_sources upserts (one per provenance)',
        };
      }
      for (const si of sourceInserts) {
        if (si.conflict !== 'doUpdate') {
          return {
            status: 'fail',
            output: `scrape_sources insert missing onConflictDoUpdate`,
            expected: 'All scrape_sources use onConflictDoUpdate',
          };
        }
      }

      // Verify deterministic scrape source IDs
      const expectedSrcId = generateScrapeSourceId(
        expectedPoemId,
        'poets.org',
        'https://poets.org/poem/raven',
      );
      const actualSrcId = sourceInserts[0].values?.id as string;
      if (actualSrcId !== expectedSrcId) {
        return {
          status: 'fail',
          output: `scrape_sources id=${actualSrcId}, expected=${expectedSrcId}`,
          expected: 'Deterministic scrape source ID from generateScrapeSourceId',
        };
      }
      info('scrape_sources: 2 upserts with deterministic IDs and onConflictDoUpdate ✓');

      return {
        status: 'pass',
        output: `1 tx; poem id=${expectedPoemId} type=HUMAN; poem_topics=delete+2; scrape_sources=2`,
      };
    },
  );
}

// ── Check 5: runLoadStage reads NDJSON and loads to mock DB ───────────────────

async function check5_runLoadStage() {
  await check(
    'runLoadStage reads 03-tag NDJSON and loads to mock DB (read=2, loaded=2, topicsUpserted=20)',
    async () => {
      const { runLoadStage } = await import('../packages/etl/src/stages/04-load');
      const { workDir, tagDir } = await makeLoadDirs();
      const db = createMockDb();

      info(`Work dir: ${workDir}`);

      // Write 2 PD poems to 03-tag/
      const poems = [POEM_A, POEM_B];
      await writeFile(
        join(tagDir, 'tag-20260201.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info(`Wrote ${poems.length} TagPoem records to 03-tag/tag-20260201.ndjson`);

      const summary = await runLoadStage(
        {
          stage: 'load',
          dryRun: false,
          includeNonPd: false,
          limit: undefined,
          inputDir: join(workDir, '00-raw'),
          workDir,
        },
        db as never,
      );

      info(
        `Summary: read=${summary.read} loaded=${summary.loaded} skippedNonPd=${summary.skippedNonPd} topicsUpserted=${summary.topicsUpserted}`,
      );

      if (summary.read !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=2',
          notes: `read mismatch: expected 2, got ${summary.read}`,
        };
      }
      if (summary.loaded !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'loaded=2',
          notes: `loaded mismatch: expected 2, got ${summary.loaded}`,
        };
      }
      if (summary.skippedNonPd !== 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'skippedNonPd=0 (all poems are public domain)',
          notes: `Unexpected non-PD skips: ${summary.skippedNonPd}`,
        };
      }
      if (summary.topicsUpserted !== 20) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'topicsUpserted=20',
          notes: `Expected 20 canonical topics upserted, got ${summary.topicsUpserted}`,
        };
      }

      // Verify DB writes occurred
      const poemInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poems');
      if (poemInserts.length !== 2) {
        return {
          status: 'fail',
          output: `poem DB inserts=${poemInserts.length}`,
          expected: '2 poem upserts in DB (one per loaded poem)',
        };
      }
      info(`${poemInserts.length} poem upserts in DB ✓`);

      const topicInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'topics');
      if (topicInserts.length !== 20) {
        return {
          status: 'fail',
          output: `topics DB inserts=${topicInserts.length}`,
          expected: '20 topic upserts',
        };
      }
      info(`${topicInserts.length} topic upserts in DB ✓`);

      return {
        status: 'pass',
        output: `read=2 loaded=2 skippedNonPd=0 topicsUpserted=20; ${poemInserts.length} poem + ${topicInserts.length} topic DB writes`,
      };
    },
  );
}

// ── Check 6: PD filtering — non-PD excluded by default ───────────────────────

async function check6_pdFiltering() {
  await check(
    'Public-domain filtering: non-PD poems excluded by default (skippedNonPd=1)',
    async () => {
      const { runLoadStage } = await import('../packages/etl/src/stages/04-load');
      const { workDir, tagDir } = await makeLoadDirs();
      const db = createMockDb();

      info(`Work dir: ${workDir}`);

      // Mix: 2 PD poems + 1 non-PD poem
      const poems = [POEM_A, POEM_B, POEM_NON_PD];
      await writeFile(
        join(tagDir, 'mixed.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 2 PD + 1 non-PD poem to 03-tag/mixed.ndjson');
      info(`  Non-PD: "${POEM_NON_PD.title}" by ${POEM_NON_PD.author}`);

      const summary = await runLoadStage(
        {
          stage: 'load',
          dryRun: false,
          includeNonPd: false, // default — must exclude non-PD
          limit: undefined,
          inputDir: join(workDir, '00-raw'),
          workDir,
        },
        db as never,
      );

      info(
        `Summary: read=${summary.read} loaded=${summary.loaded} skippedNonPd=${summary.skippedNonPd}`,
      );

      if (summary.read !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=3 (all poems parsed before PD filtering)',
          notes: `read mismatch: expected 3, got ${summary.read}`,
        };
      }
      if (summary.loaded !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'loaded=2 (only the 2 PD poems)',
          notes: `loaded mismatch: expected 2, got ${summary.loaded}`,
        };
      }
      if (summary.skippedNonPd !== 1) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'skippedNonPd=1 (the non-PD poem skipped)',
          notes: `skippedNonPd mismatch: expected 1, got ${summary.skippedNonPd}`,
        };
      }

      // Confirm only 2 poem rows were written to DB
      const poemInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poems');
      if (poemInserts.length !== 2) {
        return {
          status: 'fail',
          output: `poem DB inserts=${poemInserts.length}`,
          expected: '2 poem DB writes (non-PD poem must not reach the database)',
        };
      }
      info('Non-PD poem did not reach DB ✓');

      return {
        status: 'pass',
        output: `read=3 loaded=2 skippedNonPd=1; non-PD poem correctly excluded from DB`,
      };
    },
  );
}

// ── Check 7: --include-non-pd overrides PD filter ────────────────────────────

async function check7_includeNonPd() {
  await check(
    '--include-non-pd flag: non-PD poems loaded when flag is set (loaded=3, skippedNonPd=0)',
    async () => {
      const { runLoadStage } = await import('../packages/etl/src/stages/04-load');
      const { workDir, tagDir } = await makeLoadDirs();
      const db = createMockDb();

      info(`Work dir: ${workDir}`);

      // Same 2 PD + 1 non-PD mix
      const poems = [POEM_A, POEM_B, POEM_NON_PD];
      await writeFile(
        join(tagDir, 'all.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 2 PD + 1 non-PD poem; running with includeNonPd=true');

      const summary = await runLoadStage(
        {
          stage: 'load',
          dryRun: false,
          includeNonPd: true, // explicit override
          limit: undefined,
          inputDir: join(workDir, '00-raw'),
          workDir,
        },
        db as never,
      );

      info(
        `Summary: read=${summary.read} loaded=${summary.loaded} skippedNonPd=${summary.skippedNonPd}`,
      );

      if (summary.read !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=3',
          notes: `read mismatch: expected 3, got ${summary.read}`,
        };
      }
      if (summary.loaded !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'loaded=3 (all poems including non-PD)',
          notes: `loaded mismatch: expected 3, got ${summary.loaded}`,
        };
      }
      if (summary.skippedNonPd !== 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'skippedNonPd=0 (no filtering with --include-non-pd)',
          notes: `skippedNonPd mismatch: expected 0, got ${summary.skippedNonPd}`,
        };
      }

      const poemInserts = db._calls.filter((c) => c.op === 'insert' && c.table === 'poems');
      if (poemInserts.length !== 3) {
        return {
          status: 'fail',
          output: `poem DB inserts=${poemInserts.length}`,
          expected: '3 poem DB writes (including the non-PD poem)',
        };
      }
      info('All 3 poems (including non-PD) reached DB ✓');

      return {
        status: 'pass',
        output: `read=3 loaded=3 skippedNonPd=0; --include-non-pd correctly overrides PD filter`,
      };
    },
  );
}

// ── Check 8: Dry-run mode ─────────────────────────────────────────────────────

async function check8_dryRun() {
  await check(
    'Dry-run mode: poems counted (loaded>0) but no DB transactions executed',
    async () => {
      const { runLoadStage } = await import('../packages/etl/src/stages/04-load');
      const { workDir, tagDir } = await makeLoadDirs();
      const db = createMockDb();

      info(`Work dir: ${workDir}`);

      const poems = [POEM_A, POEM_B];
      await writeFile(
        join(tagDir, 'dryrun.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info(`Wrote 2 poems; running with dryRun=true`);

      const summary = await runLoadStage(
        {
          stage: 'load',
          dryRun: true,
          includeNonPd: false,
          limit: undefined,
          inputDir: join(workDir, '00-raw'),
          workDir,
        },
        db as never,
      );

      info(
        `Summary: read=${summary.read} loaded=${summary.loaded} topicsUpserted=${summary.topicsUpserted}`,
      );

      // In dry-run, poems are still counted (batch buffer fills, loaded increments)
      // but flushBatch() is a no-op so no DB writes occur.
      if (summary.read !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=2 (poems parsed even in dry-run)',
          notes: `read mismatch: expected 2, got ${summary.read}`,
        };
      }

      // loaded should reflect poems that would have been written (counted, not written)
      if (summary.loaded !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'loaded=2 (poems counted as would-load even in dry-run)',
          notes: `loaded mismatch: expected 2, got ${summary.loaded}`,
        };
      }
      info(`loaded=${summary.loaded} (counted, not written) ✓`);

      // topicsUpserted should report the count without actual DB writes
      if (summary.topicsUpserted !== 20) {
        return {
          status: 'fail',
          output: `topicsUpserted=${summary.topicsUpserted}`,
          expected: 'topicsUpserted=20 (dry-run reports count without writing)',
        };
      }
      info(`topicsUpserted=${summary.topicsUpserted} (dry-run count) ✓`);

      // CRITICAL: no DB transactions must have been called
      const txCalls = db._calls.filter((c) => c.op === 'transaction');
      if (txCalls.length > 0) {
        return {
          status: 'fail',
          output: `DB transactions called: ${txCalls.length}`,
          expected: '0 DB transactions in dry-run mode',
          notes: 'Both upsertTopics and flushBatch must skip DB operations in dry-run',
        };
      }
      info('0 DB transactions in dry-run ✓');

      return {
        status: 'pass',
        output: `read=2 loaded=2 topicsUpserted=20 (dry-run counts); 0 DB transactions`,
      };
    },
  );
}

// ── Check 9: CLI arg parsing ──────────────────────────────────────────────────

async function check9_cliParsing() {
  await check(
    'CLI arg parsing: --stage load, --stage all, --include-non-pd, --dry-run, --limit',
    async () => {
      info('Testing parseCliArgs...');

      // --stage load
      const loadConfig = parseCliArgs(['--stage', 'load']);
      if (loadConfig.stage !== 'load') {
        return {
          status: 'fail',
          output: `stage=${loadConfig.stage}`,
          expected: 'stage=load',
        };
      }
      info('  --stage load → stage=load ✓');

      // --stage all
      const allConfig = parseCliArgs(['--stage', 'all']);
      if (allConfig.stage !== 'all') {
        return {
          status: 'fail',
          output: `stage=${allConfig.stage}`,
          expected: 'stage=all',
        };
      }
      info('  --stage all → stage=all ✓');

      // Default (no --stage) should be 'all'
      const defaultConfig = parseCliArgs([]);
      if (defaultConfig.stage !== 'all') {
        return {
          status: 'fail',
          output: `default stage=${defaultConfig.stage}`,
          expected: 'default stage=all',
        };
      }
      info('  (no --stage) → stage=all (default) ✓');

      // --include-non-pd
      const nonPdConfig = parseCliArgs(['--stage', 'load', '--include-non-pd']);
      if (!nonPdConfig.includeNonPd) {
        return {
          status: 'fail',
          output: `includeNonPd=${nonPdConfig.includeNonPd}`,
          expected: 'includeNonPd=true',
        };
      }
      info('  --include-non-pd → includeNonPd=true ✓');

      // --dry-run
      const dryRunConfig = parseCliArgs(['--stage', 'load', '--dry-run']);
      if (!dryRunConfig.dryRun) {
        return {
          status: 'fail',
          output: `dryRun=${dryRunConfig.dryRun}`,
          expected: 'dryRun=true',
        };
      }
      info('  --dry-run → dryRun=true ✓');

      // --limit
      const limitConfig = parseCliArgs(['--stage', 'load', '--limit', '50']);
      if (limitConfig.limit !== 50) {
        return {
          status: 'fail',
          output: `limit=${limitConfig.limit}`,
          expected: 'limit=50',
        };
      }
      info('  --limit 50 → limit=50 ✓');

      // Defaults: dryRun=false, includeNonPd=false, limit=undefined
      if (loadConfig.dryRun !== false || loadConfig.includeNonPd !== false) {
        return {
          status: 'fail',
          output: `dryRun=${loadConfig.dryRun} includeNonPd=${loadConfig.includeNonPd}`,
          expected: 'dryRun=false and includeNonPd=false by default',
        };
      }
      if (loadConfig.limit !== undefined) {
        return {
          status: 'fail',
          output: `limit=${loadConfig.limit}`,
          expected: 'limit=undefined by default',
        };
      }
      info('  Defaults (dryRun=false, includeNonPd=false, limit=undefined) ✓');

      return {
        status: 'pass',
        output:
          '--stage load/all, --include-non-pd, --dry-run, --limit all parse correctly; defaults verified',
      };
    },
  );
}

// ── Check 10: Typecheck ───────────────────────────────────────────────────────

async function check10_typecheck() {
  await check('@sanctuary/etl typecheck passes (tsc --noEmit)', async () => {
    const command = 'pnpm --filter @sanctuary/etl typecheck';
    cmd(command);

    const result = await run(['pnpm', '--filter', '@sanctuary/etl', 'typecheck'], {
      timeoutMs: 120_000,
    });

    blockOutput('stderr ›', result.stderr);

    if (result.exitCode !== 0) {
      return {
        status: 'fail',
        output: result.combined.trim(),
        expected: 'tsc --noEmit exits with code 0',
        notes: `Typecheck failed (exit ${result.exitCode})`,
      };
    }

    return {
      status: 'pass',
      output: '@sanctuary/etl: typecheck OK',
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

section('Phase 5 Verification — ETL Pipeline Track (etl_pipeline_20260220)');
console.log(`  ${DIM}Repo root : ${REPO_ROOT}${RESET}`);
console.log(`  ${DIM}Timestamp : ${new Date().toISOString()}${RESET}`);
console.log(`  ${DIM}Subject   : Stage 4 — Load (04-load.ts) + CLI Orchestration${RESET}`);

try {
  await check1_automatedTests();
  await check2_deterministicIds();
  await check3_upsertTopics();
  await check4_loadPoem();
  await check5_runLoadStage();
  await check6_pdFiltering();
  await check7_includeNonPd();
  await check8_dryRun();
  await check9_cliParsing();
  await check10_typecheck();
} finally {
  await cleanupTempDirs();
}

// ── Summary ───────────────────────────────────────────────────────────────────

section('Verification Summary');

const passed = results.filter((r) => r.status === 'pass').length;
const failed = results.filter((r) => r.status === 'fail').length;
const skipped = results.filter((r) => r.status === 'skip').length;

for (const r of results) {
  const icon = r.status === 'pass' ? ICON_PASS : r.status === 'skip' ? ICON_SKIP : ICON_FAIL;
  console.log(`  ${icon}  ${r.id}. ${r.name}`);
}

console.log(
  `\n  ${GREEN}${BOLD}${passed} passed${RESET}` +
    `  ${RED}${BOLD}${failed} failed${RESET}` +
    `  ${YELLOW}${BOLD}${skipped} skipped${RESET}\n`,
);

if (failed > 0) {
  console.log(`${RED}${BOLD}  ✗ Verification FAILED — review the failing checks above.${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}  ✓ All checks passed — Phase 5 verified.${RESET}\n`);
  process.exit(0);
}
