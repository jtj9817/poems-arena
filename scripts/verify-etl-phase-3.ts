#!/usr/bin/env bun
/**
 * Phase 3 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Verifies Stage 2 — Deduplicate (02-dedup.ts):
 *   Check 1: ETL automated test suite passes
 *   Check 2: Dedup stage reads clean NDJSON input and writes deduped NDJSON output
 *   Check 3: Output NDJSON lines each pass DedupPoem schema; provenances retained
 *   Check 4: Source priority — poets.org canonical over gutenberg
 *   Check 5: Fuzzy title matching merges near-duplicates
 *   Check 6: Dry-run mode writes no output files
 *   Check 7: @sanctuary/etl typecheck passes
 *
 * Usage:
 *   bun scripts/verify-etl-phase-3.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

import {
  DedupPoemSchema,
  runDedupStage,
  type DedupPoem,
} from '../packages/etl/src/stages/02-dedup';

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

// Script lives at: scripts/verify-etl-phase-3.ts
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
 * Creates a work dir with the 01-clean sub-directory already in place
 * (so the dedup stage can glob for NDJSON files inside it).
 */
async function makeDedupDirs(): Promise<{ workDir: string; cleanDir: string }> {
  const prefix = join(os.tmpdir(), 'etl-verify-phase3-');
  const workDir = await mkdtemp(prefix + 'work-');
  const cleanDir = join(workDir, '01-clean');
  await mkdir(cleanDir, { recursive: true });
  tempDirs.push(workDir);
  return { workDir, cleanDir };
}

async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A valid CleanPoem from gutenberg (lowest priority). */
const BASE_POEM_GUTENBERG = {
  sourceId: 'p3-verify-001',
  source: 'gutenberg' as const,
  sourceUrl: 'https://gutenberg.org/poem/p3-001',
  title: 'The Ancient Oak',
  author: 'John Keats',
  year: '1820',
  content:
    "Among the ancient leaves of time\nStands tall the oak that knows no crime\nIts roots reach deep into the earth\nAnd celebrate each season's birth",
  themes: ['nature', 'time'],
  form: 'quatrain',
  isPublicDomain: true,
  scrapedAt: '2026-02-01T10:00:00.000Z',
};

/** Same poem, different source — poets.org (highest priority). */
const BASE_POEM_POETSORG = {
  ...BASE_POEM_GUTENBERG,
  sourceId: 'p3-verify-002',
  source: 'poets.org' as const,
  sourceUrl: 'https://poets.org/poem/p3-002',
  content: 'Canonical text from poets.org\nLine 2\nLine 3\nLine 4',
};

/** A completely different poem by the same author. */
const DIFFERENT_POEM = {
  ...BASE_POEM_GUTENBERG,
  sourceId: 'p3-verify-003',
  sourceUrl: 'https://gutenberg.org/poem/p3-003',
  title: 'Ode to Autumn',
  content:
    'Season of mists and mellow fruitfulness\nClose bosom-friend of the maturing sun\nConspiring with him how to load and bless\nWith fruit the vines that round the thatch-eves run',
};

/** Near-duplicate title for fuzzy-match check ("The Ancient Oak Excerpt"). */
const FUZZY_TITLE_POEM = {
  ...BASE_POEM_GUTENBERG,
  sourceId: 'p3-verify-004',
  sourceUrl: 'https://gutenberg.org/poem/p3-004',
  title: 'The Ancient Oak Excerpt',
};

// ── Check 1: Automated tests ──────────────────────────────────────────────────

async function check1_automatedTests() {
  await check('ETL automated test suite passes (pnpm --filter @sanctuary/etl test)', async () => {
    const command = 'CI=true pnpm --filter @sanctuary/etl test';
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

// ── Check 2: Dedup stage basic IO ─────────────────────────────────────────────

async function check2_basicIO(): Promise<string | null> {
  let outputNdjsonPath: string | null = null;

  await check(
    'Dedup stage reads 01-clean NDJSON input and writes unique poems to 02-dedup',
    async () => {
      const { workDir, cleanDir } = await makeDedupDirs();
      info(`Work dir: ${workDir}`);

      // Three distinct poems (no duplicates)
      const poems = [
        BASE_POEM_GUTENBERG,
        DIFFERENT_POEM,
        {
          ...DIFFERENT_POEM,
          author: 'Shelley',
          sourceId: 'p3-verify-s1',
          sourceUrl: 'https://gutenberg.org/poem/s1',
        },
      ];
      await writeFile(
        join(cleanDir, 'clean.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info(`Wrote ${poems.length} distinct poems to 01-clean/clean.ndjson`);

      const summary = await runDedupStage({
        stage: 'dedup',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'), // unused by dedup stage
        workDir,
      });

      info(
        `Summary: read=${summary.read} groups=${summary.groups} duplicatesDropped=${summary.duplicatesDropped} written=${summary.written}`,
      );

      if (summary.read !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=3',
          notes: `read count mismatch: expected 3, got ${summary.read}`,
        };
      }
      if (summary.groups !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'groups=3 (3 distinct poems)',
          notes: `groups mismatch: expected 3, got ${summary.groups}`,
        };
      }
      if (summary.duplicatesDropped !== 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'duplicatesDropped=0',
          notes: `unexpected duplicates dropped: ${summary.duplicatesDropped}`,
        };
      }
      if (summary.written !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'written=3',
          notes: `written mismatch: expected 3, got ${summary.written}`,
        };
      }

      // Find the output NDJSON
      const dedupDir = join(workDir, '02-dedup');
      const outputFiles = await readdir(dedupDir).catch(() => []);
      const ndjsonFiles = outputFiles.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No .ndjson files found in 02-dedup/',
          expected: 'At least one dedup-*.ndjson file in workDir/02-dedup/',
        };
      }

      outputNdjsonPath = join(dedupDir, ndjsonFiles[0]);
      return {
        status: 'pass',
        output: `${ndjsonFiles[0]} — read=3 groups=3 duplicatesDropped=0 written=3`,
      };
    },
  );

  return outputNdjsonPath;
}

// ── Check 3: DedupPoem schema + provenances retained ─────────────────────────

async function check3_schemaValidation(ndjsonPath: string | null) {
  await check(
    'Output NDJSON lines pass DedupPoem schema; provenances array is present',
    async () => {
      if (!ndjsonPath) {
        return {
          status: 'skip',
          output: 'Skipped — no NDJSON output path available from Check 2',
        };
      }

      info(`Validating: ${ndjsonPath}`);
      const rawContent = await readFile(ndjsonPath, 'utf-8').catch(() => '');
      if (!rawContent.trim()) {
        return {
          status: 'fail',
          output: 'Output NDJSON file is empty',
          expected: '3 schema-valid DedupPoem lines',
        };
      }

      const lines = rawContent
        .trim()
        .split('\n')
        .filter((l) => l.trim());

      const failures: string[] = [];
      const parsed: DedupPoem[] = [];

      for (let i = 0; i < lines.length; i++) {
        let json: unknown;
        try {
          json = JSON.parse(lines[i]);
        } catch {
          failures.push(`Line ${i + 1}: invalid JSON`);
          continue;
        }

        const result = DedupPoemSchema.safeParse(json);
        if (!result.success) {
          failures.push(`Line ${i + 1}: ${result.error.issues.map((e) => e.message).join(', ')}`);
        } else {
          parsed.push(result.data);
        }
      }

      if (failures.length > 0) {
        return {
          status: 'fail',
          output: failures.join('\n'),
          expected: 'All lines pass DedupPoemSchema validation',
        };
      }

      // Each poem must have at least one provenance
      const missingProvenance = parsed.filter((p) => p.provenances.length === 0);
      if (missingProvenance.length > 0) {
        return {
          status: 'fail',
          output: `${missingProvenance.length} poem(s) have empty provenances array`,
          expected: 'Every DedupPoem has at least one provenance entry',
        };
      }

      return {
        status: 'pass',
        output: `${parsed.length}/${lines.length} lines validated; all have ≥1 provenance`,
      };
    },
  );
}

// ── Check 4: Source priority (poets.org > gutenberg) ─────────────────────────

async function check4_sourcePriority() {
  await check(
    'Source priority: poets.org canonical text selected over gutenberg duplicate',
    async () => {
      const { workDir, cleanDir } = await makeDedupDirs();
      info(`Work dir: ${workDir}`);

      // Same poem from two sources — poets.org should win
      const poems = [BASE_POEM_GUTENBERG, BASE_POEM_POETSORG];
      await writeFile(
        join(cleanDir, 'priority.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 2 poems with same title/author, different sources (gutenberg, poets.org)');

      const summary = await runDedupStage({
        stage: 'dedup',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} groups=${summary.groups} duplicatesDropped=${summary.duplicatesDropped} written=${summary.written}`,
      );

      if (summary.groups !== 1) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'groups=1 (two copies merged into one)',
          notes: `Duplicate was not detected — got ${summary.groups} groups`,
        };
      }
      if (summary.duplicatesDropped !== 1) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'duplicatesDropped=1',
        };
      }

      // Read the output and verify canonical content
      const dedupDir = join(workDir, '02-dedup');
      const files = await readdir(dedupDir).catch(() => []);
      const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No output file found in 02-dedup/',
          expected: 'A dedup-*.ndjson file with 1 poem',
        };
      }

      const content = await readFile(join(dedupDir, ndjsonFiles[0]), 'utf-8');
      const poem = JSON.parse(content.trim()) as DedupPoem;

      if (poem.content !== BASE_POEM_POETSORG.content) {
        return {
          status: 'fail',
          output: `canonical content: ${JSON.stringify(poem.content)}`,
          expected: `poets.org content: ${JSON.stringify(BASE_POEM_POETSORG.content)}`,
          notes: 'poets.org should have been selected as canonical source',
        };
      }

      if (poem.provenances.length !== 2) {
        return {
          status: 'fail',
          output: `provenances.length=${poem.provenances.length}`,
          expected: 'provenances.length=2 (both sources retained)',
          notes: 'Both source provenances must be preserved after deduplication',
        };
      }

      const sources = poem.provenances.map((p) => p.source).sort();
      if (!sources.includes('poets.org') || !sources.includes('gutenberg')) {
        return {
          status: 'fail',
          output: `provenances sources: ${sources.join(', ')}`,
          expected: 'both poets.org and gutenberg in provenances',
        };
      }

      return {
        status: 'pass',
        output: `poets.org canonical; provenances=[${sources.join(', ')}]`,
      };
    },
  );
}

// ── Check 5: Fuzzy title matching ─────────────────────────────────────────────

async function check5_fuzzyMatch() {
  await check(
    'Fuzzy title matching groups "The Ancient Oak Excerpt" with "The Ancient Oak"',
    async () => {
      const { workDir, cleanDir } = await makeDedupDirs();
      info(`Work dir: ${workDir}`);

      // Base + fuzzy-title variant (same author)
      const poems = [BASE_POEM_GUTENBERG, FUZZY_TITLE_POEM];
      await writeFile(
        join(cleanDir, 'fuzzy.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 2 poems: "The Ancient Oak" and "The Ancient Oak Excerpt" (same author)');

      const summary = await runDedupStage({
        stage: 'dedup',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} groups=${summary.groups} duplicatesDropped=${summary.duplicatesDropped} written=${summary.written}`,
      );

      if (summary.groups !== 1) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'groups=1 (fuzzy match merged both into one group)',
          notes: `Fuzzy title match did not fire — got ${summary.groups} groups`,
        };
      }
      if (summary.duplicatesDropped !== 1) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'duplicatesDropped=1',
        };
      }

      return {
        status: 'pass',
        output: `Fuzzy match succeeded: 2 poems → 1 group (${summary.duplicatesDropped} dropped)`,
      };
    },
  );
}

// ── Check 6: Dry-run writes no files ─────────────────────────────────────────

async function check6_dryRun() {
  await check('Dry-run mode writes no output files (written === 0)', async () => {
    const { workDir, cleanDir } = await makeDedupDirs();
    info(`Work dir: ${workDir}`);

    await writeFile(
      join(cleanDir, 'dryrun.ndjson'),
      [BASE_POEM_GUTENBERG, DIFFERENT_POEM].map((p) => JSON.stringify(p)).join('\n') + '\n',
    );
    info('Wrote 2 distinct poems to 01-clean/dryrun.ndjson');

    const summary = await runDedupStage({
      stage: 'dedup',
      dryRun: true,
      includeNonPd: false,
      limit: undefined,
      inputDir: join(workDir, '00-raw'),
      workDir,
    });

    info(`Summary: read=${summary.read} groups=${summary.groups} written=${summary.written}`);

    if (summary.written !== 0) {
      return {
        status: 'fail',
        output: JSON.stringify(summary, null, 2),
        expected: 'written=0 in dry-run mode',
        notes: `written was ${summary.written} — dry-run should suppress all file writes`,
      };
    }

    // Verify no NDJSON file was created
    const dedupDir = join(workDir, '02-dedup');
    const outputFiles = await readdir(dedupDir).catch(() => []);
    const ndjsonFiles = outputFiles.filter((f) => f.endsWith('.ndjson'));

    if (ndjsonFiles.length > 0) {
      return {
        status: 'fail',
        output: `Found NDJSON files despite dry-run: ${ndjsonFiles.join(', ')}`,
        expected: 'No .ndjson files written in dry-run mode',
      };
    }

    return {
      status: 'pass',
      output: `read=${summary.read} groups=${summary.groups} written=0 — no files created`,
    };
  });
}

// ── Check 7: Typecheck ────────────────────────────────────────────────────────

async function check7_typecheck() {
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

section('Phase 3 Verification — ETL Pipeline Track (etl_pipeline_20260220)');
console.log(`  ${DIM}Repo root : ${REPO_ROOT}${RESET}`);
console.log(`  ${DIM}Timestamp : ${new Date().toISOString()}${RESET}`);
console.log(`  ${DIM}Subject   : Stage 2 — Deduplicate (02-dedup.ts)${RESET}`);

try {
  await check1_automatedTests();
  const ndjsonPath = await check2_basicIO();
  await check3_schemaValidation(ndjsonPath);
  await check4_sourcePriority();
  await check5_fuzzyMatch();
  await check6_dryRun();
  await check7_typecheck();
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
  console.log(`${GREEN}${BOLD}  ✓ All checks passed — Phase 3 verified.${RESET}\n`);
  process.exit(0);
}
