#!/usr/bin/env bun
/**
 * Phase 6 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Verifies Regression & Quality Gate:
 *   Check 1: `pnpm --filter @sanctuary/etl test` passes
 *   Check 2: `pnpm lint` passes
 *   Check 3: `pnpm format:check` passes
 *   Check 4: Full pipeline run twice has stable stage summaries and DB row counts
 *   Check 5: Dedup source priority is respected (poets.org wins)
 *   Check 6: Poems without themes receive topics via keyword fallback
 *   Check 7: Non-PD poems are excluded by default and included with override
 *
 * Usage:
 *   bun scripts/verify-etl-phase-6.ts
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

import type { CliConfig } from '../packages/etl/src/index';
import { runCleanStage, type CleanPoem } from '../packages/etl/src/stages/01-clean';
import {
  resolveDuplicates,
  runDedupStage,
  type DedupPoem,
} from '../packages/etl/src/stages/02-dedup';
import { runTagStage } from '../packages/etl/src/stages/03-tag';
import { runLoadStage } from '../packages/etl/src/stages/04-load';
import { assignTopics } from '../packages/etl/src/mappings/theme-to-topic';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

const ICON_PASS = `${GREEN}${BOLD}✓ PASS${RESET}`;
const ICON_FAIL = `${RED}${BOLD}✗ FAIL${RESET}`;

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const DRIZZLE_NAME = Symbol.for('drizzle:Name');

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

interface CheckResult {
  id: number;
  name: string;
  status: 'pass' | 'fail';
  output: string;
  expected?: string;
  notes?: string;
}

interface LoadedPoem {
  title: string;
  author: string;
  year: string | null;
  content: string;
  themes: string[];
  form: string | null;
  provenances: {
    sourceId: string;
    source: 'poets.org' | 'poetry-foundation' | 'loc-180' | 'gutenberg';
    sourceUrl: string;
    isPublicDomain: boolean;
    scrapedAt: string;
  }[];
  topics: string[];
}

function section(title: string) {
  const bar = '─'.repeat(60);
  console.log(`\n${CYAN}${BOLD}${bar}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}${bar}${RESET}`);
}

function cmd(command: string) {
  console.log(`  ${BLUE}${DIM}$ ${command}${RESET}`);
}

function blockOutput(label: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  for (const line of trimmed.split('\n')) {
    console.log(`  ${DIM}${label}${RESET} ${line}`);
  }
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
    timer = setTimeout(() => proc.kill(), timeoutMs);
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited.catch(() => {});
  clearTimeout(timer);

  const exitCode = proc.exitCode ?? 1;
  return { exitCode, stdout, stderr, combined: `${stdout}\n${stderr}` };
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
    const out = await fn();
    result = { id, name, ...out };
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    result = {
      id,
      name,
      status: 'fail',
      output: message,
      notes: 'Unhandled exception in check function',
    };
  }

  results.push(result);
  console.log(`  Status: ${result.status === 'pass' ? ICON_PASS : ICON_FAIL}`);
  if (result.output) blockOutput('out ›', result.output);
  if (result.expected) blockOutput('expected ›', result.expected);
  if (result.notes) blockOutput('note ›', result.notes);
}

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function cleanupTempDirs() {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
}

function makeCliConfig(inputDir: string, workDir: string, includeNonPd = false): CliConfig {
  return {
    stage: 'all',
    dryRun: false,
    includeNonPd,
    limit: undefined,
    inputDir,
    workDir,
  };
}

function tableNameOf(table: unknown): string {
  if (table && typeof table === 'object') {
    const rawName = (table as Record<symbol, unknown>)[DRIZZLE_NAME];
    if (typeof rawName === 'string') return rawName;
  }
  return 'unknown';
}

function createStatefulMockDb() {
  const state = {
    topics: new Map<string, { id: string; label: string }>(),
    poems: new Map<string, LoadedPoem>(),
    poemTopics: new Set<string>(),
    scrapeSources: new Map<string, Record<string, unknown>>(),
  };

  const stats = {
    transactionCalls: 0,
    insertCalls: 0,
    deleteCalls: 0,
  };

  function applyInsert(tableName: string, values: Record<string, unknown>) {
    stats.insertCalls++;

    if (tableName === 'topics') {
      const id = String(values.id);
      state.topics.set(id, { id, label: String(values.label ?? '') });
      return;
    }

    if (tableName === 'poems') {
      const id = String(values.id);
      state.poems.set(id, values as unknown as LoadedPoem);
      return;
    }

    if (tableName === 'poem_topics') {
      const key = `${String(values.poemId)}::${String(values.topicId)}`;
      state.poemTopics.add(key);
      return;
    }

    if (tableName === 'scrape_sources') {
      const id = String(values.id);
      state.scrapeSources.set(id, values);
    }
  }

  function makeInsertChain(tableName: string) {
    let insertValues: Record<string, unknown> = {};
    let inserted = false;

    const commit = () => {
      if (inserted) return;
      inserted = true;
      applyInsert(tableName, insertValues);
    };

    const chain = {
      values(values: Record<string, unknown>) {
        insertValues = values;
        return chain;
      },
      onConflictDoUpdate(_opts: { target: unknown; set: Record<string, unknown> }) {
        commit();
        return chain;
      },
      then(resolve: (value?: unknown) => void) {
        commit();
        resolve();
      },
    };

    return chain;
  }

  const db = {
    insert(table: unknown) {
      return makeInsertChain(tableNameOf(table));
    },
    delete(_table: unknown) {
      stats.deleteCalls++;
      return {
        where(_condition: unknown) {
          return Promise.resolve();
        },
      };
    },
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      stats.transactionCalls++;
      const tx = {
        insert: db.insert.bind(db),
        delete: db.delete.bind(db),
      };
      await fn(tx);
    },
    _state: state,
    _stats: stats,
  };

  return db;
}

function makeRawPoems() {
  return [
    {
      sourceId: 'phase6-pd-g-001',
      source: 'gutenberg' as const,
      sourceUrl: 'https://gutenberg.org/poem/phase6-raven',
      title: 'The Raven',
      author: 'Edgar Allan Poe',
      year: '1845',
      content: 'Once upon a midnight dreary\nline two\nline three\nline four',
      themes: ['night'],
      form: 'narrative',
      isPublicDomain: true,
      scrapedAt: '2026-02-21T00:00:00.000Z',
    },
    {
      sourceId: 'phase6-pd-p-001',
      source: 'poets.org' as const,
      sourceUrl: 'https://poets.org/poem/phase6-raven',
      title: 'The Raven',
      author: 'Edgar Allan Poe',
      year: '1845',
      content: 'Poets canonical raven line one\nline two\nline three\nline four',
      themes: ['night'],
      form: 'narrative',
      isPublicDomain: true,
      scrapedAt: '2026-02-21T00:00:00.000Z',
    },
    {
      sourceId: 'phase6-pd-g-002',
      source: 'gutenberg' as const,
      sourceUrl: 'https://gutenberg.org/poem/phase6-sea',
      title: 'Sea Song',
      author: 'Anonymous',
      year: null,
      content: 'The ocean wind moves through the night\nline two\nline three\nline four',
      themes: [] as string[],
      form: null,
      isPublicDomain: true,
      scrapedAt: '2026-02-21T00:00:00.000Z',
    },
    {
      sourceId: 'phase6-nonpd-001',
      source: 'poetry-foundation' as const,
      sourceUrl: 'https://www.poetryfoundation.org/poems/phase6-modern',
      title: 'Modern Copyrighted Poem',
      author: 'Contemporary Author',
      year: '2015',
      content: 'City glass and electric rain\nline two\nline three\nline four',
      themes: ['identity'],
      form: 'free verse',
      isPublicDomain: false,
      scrapedAt: '2026-02-21T00:00:00.000Z',
    },
  ];
}

async function runPipelineOnce(
  inputDir: string,
  workDir: string,
  db: ReturnType<typeof createStatefulMockDb>,
) {
  const config = makeCliConfig(inputDir, workDir, false);
  const clean = await runCleanStage(config);
  const dedup = await runDedupStage(config);
  const tag = await runTagStage(config);
  const load = await runLoadStage(config, db as never);
  return { clean, dedup, tag, load };
}

function toStableSummary(summary: {
  clean: { read: number; valid: number; skipped: number; written: number };
  dedup: { read: number; groups: number; duplicatesDropped: number; written: number };
  tag: { read: number; tagged: number; fallback: number; written: number };
  load: { read: number; loaded: number; skippedNonPd: number; topicsUpserted: number };
}) {
  return {
    clean: { read: summary.clean.read, valid: summary.clean.valid, skipped: summary.clean.skipped },
    dedup: {
      read: summary.dedup.read,
      groups: summary.dedup.groups,
      duplicatesDropped: summary.dedup.duplicatesDropped,
    },
    tag: { read: summary.tag.read, tagged: summary.tag.tagged, fallback: summary.tag.fallback },
    load: {
      read: summary.load.read,
      loaded: summary.load.loaded,
      skippedNonPd: summary.load.skippedNonPd,
    },
  };
}

async function check1EtlTests() {
  await check('ETL automated test suite passes', async () => {
    cmd('CI=true pnpm --filter @sanctuary/etl test');
    const result = await run(['pnpm', '--filter', '@sanctuary/etl', 'test'], {
      timeoutMs: 120_000,
    });
    blockOutput('stdout ›', result.stdout);
    blockOutput('stderr ›', result.stderr);

    if (result.exitCode !== 0) {
      return {
        status: 'fail' as const,
        output: result.combined.trim(),
        expected: 'ETL tests pass with exit code 0',
      };
    }

    return {
      status: 'pass' as const,
      output: 'ETL tests passed.',
    };
  });
}

async function check2Lint() {
  await check('Workspace lint passes', async () => {
    cmd('CI=true pnpm lint');
    const result = await run(['pnpm', 'lint'], { timeoutMs: 120_000 });
    blockOutput('stdout ›', result.stdout);
    blockOutput('stderr ›', result.stderr);

    if (result.exitCode !== 0) {
      return {
        status: 'fail' as const,
        output: result.combined.trim(),
        expected: 'pnpm lint passes with exit code 0',
      };
    }

    return {
      status: 'pass' as const,
      output: 'Lint passed.',
    };
  });
}

async function check3FormatCheck() {
  await check('Workspace format check passes', async () => {
    cmd('CI=true pnpm format:check');
    const result = await run(['pnpm', 'format:check'], { timeoutMs: 120_000 });
    blockOutput('stdout ›', result.stdout);
    blockOutput('stderr ›', result.stderr);

    if (result.exitCode !== 0) {
      return {
        status: 'fail' as const,
        output: result.combined.trim(),
        expected: 'pnpm format:check passes with exit code 0',
      };
    }

    return {
      status: 'pass' as const,
      output: 'Format check passed.',
    };
  });
}

async function check4PipelineTwiceIdempotent() {
  await check('Pipeline run twice has stable counts and no row multiplication', async () => {
    const inputDir = await createTempDir('etl-phase6-input-');
    const workDirA = await createTempDir('etl-phase6-work-a-');
    const workDirB = await createTempDir('etl-phase6-work-b-');

    await writeFile(join(inputDir, 'raw.json'), JSON.stringify(makeRawPoems(), null, 2), 'utf8');

    const db = createStatefulMockDb();
    const first = await runPipelineOnce(inputDir, workDirA, db);
    const firstRows = {
      topics: db._state.topics.size,
      poems: db._state.poems.size,
      poemTopics: db._state.poemTopics.size,
      scrapeSources: db._state.scrapeSources.size,
    };

    const second = await runPipelineOnce(inputDir, workDirB, db);
    const secondRows = {
      topics: db._state.topics.size,
      poems: db._state.poems.size,
      poemTopics: db._state.poemTopics.size,
      scrapeSources: db._state.scrapeSources.size,
    };

    const stableCounts =
      JSON.stringify(toStableSummary(first)) === JSON.stringify(toStableSummary(second));

    const stableRows = JSON.stringify(firstRows) === JSON.stringify(secondRows);

    if (!stableCounts || !stableRows) {
      return {
        status: 'fail' as const,
        output: `stableCounts=${stableCounts} stableRows=${stableRows} first=${JSON.stringify(toStableSummary(first))} second=${JSON.stringify(toStableSummary(second))} firstRows=${JSON.stringify(firstRows)} secondRows=${JSON.stringify(secondRows)}`,
        expected: 'Equivalent stage summaries and unchanged DB row counts across run #1 and run #2',
      };
    }

    return {
      status: 'pass' as const,
      output: `Stable summaries and row counts confirmed (${JSON.stringify(secondRows)}).`,
    };
  });
}

async function check5SourcePriority() {
  await check('Dedup source priority selects poets.org over all other sources', async () => {
    const base: Omit<CleanPoem, 'source' | 'sourceId' | 'sourceUrl' | 'content'> = {
      title: 'The Shared Poem',
      author: 'Canonical Author',
      year: '1900',
      themes: ['nature'],
      form: null,
      isPublicDomain: true,
      scrapedAt: '2026-02-21T00:00:00.000Z',
    };

    const group: CleanPoem[] = [
      {
        ...base,
        sourceId: 's1',
        source: 'gutenberg',
        sourceUrl: 'https://gutenberg.org/shared',
        content: 'Gutenberg text\nline2\nline3\nline4',
      },
      {
        ...base,
        sourceId: 's2',
        source: 'loc-180',
        sourceUrl: 'https://loc.gov/shared',
        content: 'LOC text\nline2\nline3\nline4',
      },
      {
        ...base,
        sourceId: 's3',
        source: 'poetry-foundation',
        sourceUrl: 'https://poetryfoundation.org/shared',
        content: 'Poetry Foundation text\nline2\nline3\nline4',
      },
      {
        ...base,
        sourceId: 's4',
        source: 'poets.org',
        sourceUrl: 'https://poets.org/shared',
        content: 'Poets canonical text\nline2\nline3\nline4',
      },
    ];

    const resolved = resolveDuplicates(group);
    if (resolved.content !== 'Poets canonical text\nline2\nline3\nline4') {
      return {
        status: 'fail' as const,
        output: `Resolved content was: ${resolved.content}`,
        expected: 'Resolved canonical poem uses poets.org content',
      };
    }

    return {
      status: 'pass' as const,
      output: `Priority resolution selected poets.org with ${resolved.provenances.length} provenances retained.`,
    };
  });
}

async function check6KeywordFallback() {
  await check('Poems without themes receive fallback keyword topics', async () => {
    const assigned = assignTopics(
      [],
      'Moonlit Shore',
      'The moon above the ocean glows\nWaves rise and fall\nNight wind drifts\nSalt in the air',
    );

    if (!assigned.usedFallback || assigned.topics.length === 0) {
      return {
        status: 'fail' as const,
        output: JSON.stringify(assigned),
        expected: 'Fallback used and at least one canonical topic assigned',
      };
    }

    return {
      status: 'pass' as const,
      output: `Fallback topics assigned: ${assigned.topics.join(', ')}`,
    };
  });
}

async function check7NonPdFiltering() {
  await check('Load stage excludes non-PD by default and includes with override', async () => {
    const workDir = await createTempDir('etl-phase6-load-filter-');
    const tagDir = join(workDir, '03-tag');
    await mkdir(tagDir, { recursive: true });

    const pdPoem: DedupPoem & { topics: string[] } = {
      title: 'Public Domain Piece',
      author: 'Anonymous',
      year: null,
      content: 'line one\nline two\nline three\nline four',
      themes: ['nature'],
      form: null,
      topics: ['nature'],
      provenances: [
        {
          sourceId: 'pd-001',
          source: 'gutenberg',
          sourceUrl: 'https://gutenberg.org/pd',
          isPublicDomain: true,
          scrapedAt: '2026-02-21T00:00:00.000Z',
        },
      ],
    };

    const nonPdPoem: DedupPoem & { topics: string[] } = {
      title: 'Copyrighted Piece',
      author: 'Modern Author',
      year: '2019',
      content: 'line one\nline two\nline three\nline four',
      themes: ['identity'],
      form: 'free verse',
      topics: ['identity'],
      provenances: [
        {
          sourceId: 'npd-001',
          source: 'poetry-foundation',
          sourceUrl: 'https://poetryfoundation.org/nonpd',
          isPublicDomain: false,
          scrapedAt: '2026-02-21T00:00:00.000Z',
        },
      ],
    };

    await writeFile(
      join(tagDir, 'tag-fixture.ndjson'),
      `${JSON.stringify(pdPoem)}\n${JSON.stringify(nonPdPoem)}\n`,
      'utf8',
    );

    const dbDefault = createStatefulMockDb();
    const defaultSummary = await runLoadStage(
      makeCliConfig('', workDir, false),
      dbDefault as never,
    );

    const dbOverride = createStatefulMockDb();
    const overrideSummary = await runLoadStage(
      makeCliConfig('', workDir, true),
      dbOverride as never,
    );

    const okDefault = defaultSummary.loaded === 1 && defaultSummary.skippedNonPd === 1;
    const okOverride = overrideSummary.loaded === 2 && overrideSummary.skippedNonPd === 0;

    if (!okDefault || !okOverride) {
      return {
        status: 'fail' as const,
        output: `default=${JSON.stringify(defaultSummary)} override=${JSON.stringify(overrideSummary)}`,
        expected: 'Default skips non-PD, include override loads both poems',
      };
    }

    return {
      status: 'pass' as const,
      output: `Default: loaded=${defaultSummary.loaded}/skipped=${defaultSummary.skippedNonPd}; override: loaded=${overrideSummary.loaded}/skipped=${overrideSummary.skippedNonPd}`,
    };
  });
}

async function main() {
  section('Phase 6 — Regression & Quality Gate Verification');

  await check1EtlTests();
  await check2Lint();
  await check3FormatCheck();
  await check4PipelineTwiceIdempotent();
  await check5SourcePriority();
  await check6KeywordFallback();
  await check7NonPdFiltering();

  section('Result Summary');
  const failed = results.filter((r) => r.status === 'fail');
  for (const result of results) {
    const icon = result.status === 'pass' ? ICON_PASS : ICON_FAIL;
    console.log(`  ${icon}  [${result.id}] ${result.name}`);
  }

  await cleanupTempDirs();

  if (failed.length > 0) {
    console.log(`\n${RED}${BOLD}Phase 6 verification FAILED (${failed.length} check(s))${RESET}`);
    process.exit(1);
  }

  console.log(
    `\n${GREEN}${BOLD}Phase 6 verification PASSED (${results.length}/${results.length})${RESET}`,
  );
}

await main();
