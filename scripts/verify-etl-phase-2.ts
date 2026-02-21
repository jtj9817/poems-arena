#!/usr/bin/env bun
/**
 * Phase 2 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Verifies Stage 1 — Clean (01-clean.ts):
 *   Check 1: ETL automated test suite passes
 *   Check 2: Clean stage processes JSON input and writes valid NDJSON output
 *   Check 3: Output NDJSON lines each pass CleanPoem schema validation
 *   Check 4: Clean stage processes NDJSON input
 *   Check 5: Invalid poems are skipped without halting the run
 *   Check 6: Dry-run mode writes no output files
 *   Check 7: @sanctuary/etl typecheck passes
 *
 * Usage:
 *   bun scripts/verify-etl-phase-2.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

import {
  CleanPoemSchema,
  runCleanStage,
  type CleanPoem,
} from '../packages/etl/src/stages/01-clean';

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

// Script lives at: scripts/verify-etl-phase-2.ts
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

async function makeTempDirs(): Promise<{ inputDir: string; workDir: string }> {
  const prefix = join(os.tmpdir(), 'etl-verify-phase2-');
  const inputDir = await mkdtemp(prefix + 'input-');
  const workDir = await mkdtemp(prefix + 'work-');
  tempDirs.push(inputDir, workDir);
  return { inputDir, workDir };
}

async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_POEM = {
  sourceId: 'verify-001',
  source: 'gutenberg' as const,
  sourceUrl: 'https://gutenberg.org/poem/verify-001',
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

/** Three valid poems for JSON input testing. */
const THREE_VALID_POEMS = [
  BASE_POEM,
  {
    ...BASE_POEM,
    sourceId: 'verify-002',
    sourceUrl: 'https://gutenberg.org/poem/verify-002',
    title: 'Ode to Autumn',
    author: 'John Keats',
    content:
      'Season of mists and mellow fruitfulness\nClose bosom-friend of the maturing sun\nConspiring with him how to load and bless\nWith fruit the vines that round the thatch-eves run',
  },
  {
    ...BASE_POEM,
    sourceId: 'verify-003',
    sourceUrl: 'https://gutenberg.org/poem/verify-003',
    title: '  HTML &amp; Whitespace  ',
    content: '<p>line one</p>\n<p>  line two  </p>\n\n\n\nline three\nline four',
  },
];

/** Mix: 2 valid + 1 empty-title (invalid) + 1 only-3-lines (invalid). */
const MIXED_POEMS = [
  BASE_POEM,
  { ...BASE_POEM, sourceId: 'verify-004', sourceUrl: 'https://gutenberg.org/poem/verify-004' },
  { ...BASE_POEM, sourceId: 'verify-invalid-001', title: '' },
  {
    ...BASE_POEM,
    sourceId: 'verify-invalid-002',
    content: 'line one\nline two\nline three',
  },
];

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
        expected: 'All 32 unit tests pass (exit code 0)',
        notes: `Process exited with code ${result.exitCode}`,
      };
    }

    // Confirm test counts are present in output
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

// ── Check 2: JSON input → NDJSON output ──────────────────────────────────────

async function check2_jsonInput(): Promise<string | null> {
  let outputNdjsonPath: string | null = null;

  await check('Clean stage processes JSON input and writes valid NDJSON output', async () => {
    const { inputDir, workDir } = await makeTempDirs();
    info(`Input dir: ${inputDir}`);
    info(`Work dir:  ${workDir}`);

    // Write valid poems as a JSON array
    await writeFile(join(inputDir, 'test.json'), JSON.stringify(THREE_VALID_POEMS));
    info('Wrote 3 valid poems to test.json');

    const summary = await runCleanStage({
      stage: 'clean',
      dryRun: false,
      includeNonPd: false,
      limit: undefined,
      inputDir,
      workDir,
    });

    info(
      `Summary: read=${summary.read} valid=${summary.valid} skipped=${summary.skipped} written=${summary.written}`,
    );

    // Verify summary counts
    const countErrors: string[] = [];
    if (summary.read !== 3) countErrors.push(`read: expected 3, got ${summary.read}`);
    if (summary.valid !== 3) countErrors.push(`valid: expected 3, got ${summary.valid}`);
    if (summary.skipped !== 0) countErrors.push(`skipped: expected 0, got ${summary.skipped}`);
    if (summary.written !== 3) countErrors.push(`written: expected 3, got ${summary.written}`);

    if (countErrors.length > 0) {
      return {
        status: 'fail',
        output: JSON.stringify(summary, null, 2),
        expected: 'read=3, valid=3, skipped=0, written=3',
        notes: countErrors.join('; '),
      };
    }

    // Verify output directory and NDJSON file
    const cleanDir = join(workDir, '01-clean');
    const outputFiles = await readdir(cleanDir).catch(() => []);

    if (outputFiles.length === 0) {
      return {
        status: 'fail',
        output: 'No files found in 01-clean/ output directory',
        expected: 'At least one .ndjson file in workDir/01-clean/',
      };
    }

    const ndjsonFiles = outputFiles.filter((f) => f.endsWith('.ndjson'));
    if (ndjsonFiles.length === 0) {
      return {
        status: 'fail',
        output: `Files found but none with .ndjson extension: ${outputFiles.join(', ')}`,
        expected: 'A .ndjson output file in workDir/01-clean/',
      };
    }

    outputNdjsonPath = join(cleanDir, ndjsonFiles[0]);
    const rawContent = await readFile(outputNdjsonPath, 'utf-8');
    const lines = rawContent
      .trim()
      .split('\n')
      .filter((l) => l.trim());

    if (lines.length !== 3) {
      return {
        status: 'fail',
        output: `NDJSON file has ${lines.length} lines`,
        expected: '3 non-empty lines in output NDJSON',
      };
    }

    // Check title normalization (poem 3 had HTML entities and extra spaces)
    const poem3 = JSON.parse(lines[2]) as Record<string, unknown>;
    if (poem3.title !== 'HTML & Whitespace') {
      return {
        status: 'fail',
        output: `title: ${JSON.stringify(poem3.title)}`,
        expected: '"HTML & Whitespace" (HTML entity decoded, whitespace trimmed)',
        notes: 'Title normalization did not produce expected output',
      };
    }

    return {
      status: 'pass',
      output: `${ndjsonFiles[0]} — ${lines.length} lines, title normalization verified`,
    };
  });

  return outputNdjsonPath;
}

// ── Check 3: CleanPoem schema validation ─────────────────────────────────────

async function check3_schemaValidation(ndjsonPath: string | null) {
  await check('Output NDJSON lines each pass CleanPoem schema validation', async () => {
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
        expected: '3 schema-valid CleanPoem lines',
      };
    }

    const lines = rawContent
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    const failures: string[] = [];
    const parsed: CleanPoem[] = [];

    for (let i = 0; i < lines.length; i++) {
      let json: unknown;
      try {
        json = JSON.parse(lines[i]);
      } catch {
        failures.push(`Line ${i + 1}: invalid JSON`);
        continue;
      }

      const result = CleanPoemSchema.safeParse(json);
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
        expected: 'All lines pass CleanPoemSchema validation',
      };
    }

    // Spot-check provenance preservation on first poem
    const first = parsed[0];
    const provenanceOk =
      first.sourceId === BASE_POEM.sourceId &&
      first.source === BASE_POEM.source &&
      first.sourceUrl === BASE_POEM.sourceUrl &&
      first.isPublicDomain === BASE_POEM.isPublicDomain &&
      first.scrapedAt === BASE_POEM.scrapedAt;

    if (!provenanceOk) {
      return {
        status: 'fail',
        output: JSON.stringify(
          { sourceId: first.sourceId, source: first.source, isPublicDomain: first.isPublicDomain },
          null,
          2,
        ),
        expected: 'Provenance fields preserved verbatim from input',
        notes: 'sourceId, source, sourceUrl, isPublicDomain, or scrapedAt mismatch',
      };
    }

    return {
      status: 'pass',
      output: `${parsed.length}/${lines.length} lines validated; provenance fields preserved`,
    };
  });
}

// ── Check 4: NDJSON input ─────────────────────────────────────────────────────

async function check4_ndjsonInput() {
  await check('Clean stage processes NDJSON input (one record per line)', async () => {
    const { inputDir, workDir } = await makeTempDirs();
    info(`Input dir: ${inputDir}`);
    info(`Work dir:  ${workDir}`);

    const poemA = {
      ...BASE_POEM,
      sourceId: 'ndjson-001',
      sourceUrl: 'https://gutenberg.org/poem/ndjson-001',
    };
    const poemB = {
      ...BASE_POEM,
      sourceId: 'ndjson-002',
      sourceUrl: 'https://gutenberg.org/poem/ndjson-002',
      title: 'Second Poem',
    };

    const ndjsonContent = [JSON.stringify(poemA), JSON.stringify(poemB)].join('\n') + '\n';
    await writeFile(join(inputDir, 'test.ndjson'), ndjsonContent);
    info('Wrote 2 valid poems to test.ndjson');

    const summary = await runCleanStage({
      stage: 'clean',
      dryRun: false,
      includeNonPd: false,
      limit: undefined,
      inputDir,
      workDir,
    });

    info(
      `Summary: read=${summary.read} valid=${summary.valid} skipped=${summary.skipped} written=${summary.written}`,
    );

    if (summary.read !== 2 || summary.valid !== 2 || summary.written !== 2) {
      return {
        status: 'fail',
        output: JSON.stringify(summary, null, 2),
        expected: 'read=2, valid=2, written=2',
        notes: 'NDJSON input was not processed correctly',
      };
    }

    return {
      status: 'pass',
      output: `read=2 valid=2 skipped=0 written=2`,
    };
  });
}

// ── Check 5: Invalid poems are skipped ───────────────────────────────────────

async function check5_invalidPoemsSkipped() {
  await check(
    'Invalid poems (empty title, < 4 lines) are skipped without halting the run',
    async () => {
      const { inputDir, workDir } = await makeTempDirs();
      info(`Input dir: ${inputDir}`);
      info(`Work dir:  ${workDir}`);

      await writeFile(join(inputDir, 'mixed.json'), JSON.stringify(MIXED_POEMS));
      info('Wrote 4 poems (2 valid, 1 empty-title, 1 only-3-lines) to mixed.json');

      const summary = await runCleanStage({
        stage: 'clean',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir,
        workDir,
      });

      info(
        `Summary: read=${summary.read} valid=${summary.valid} skipped=${summary.skipped} written=${summary.written}`,
      );

      const countErrors: string[] = [];
      if (summary.read !== 4) countErrors.push(`read: expected 4, got ${summary.read}`);
      if (summary.valid !== 2) countErrors.push(`valid: expected 2, got ${summary.valid}`);
      if (summary.skipped !== 2) countErrors.push(`skipped: expected 2, got ${summary.skipped}`);
      if (summary.written !== 2) countErrors.push(`written: expected 2, got ${summary.written}`);

      if (countErrors.length > 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=4, valid=2, skipped=2, written=2',
          notes: countErrors.join('; '),
        };
      }

      return {
        status: 'pass',
        output: `read=4 valid=2 skipped=2 written=2 — run completed without halting`,
      };
    },
  );
}

// ── Check 6: Dry-run writes no files ─────────────────────────────────────────

async function check6_dryRun() {
  await check('Dry-run mode writes no output files (written === 0)', async () => {
    const { inputDir, workDir } = await makeTempDirs();
    info(`Input dir: ${inputDir}`);
    info(`Work dir:  ${workDir}`);

    await writeFile(
      join(inputDir, 'dryrun.json'),
      JSON.stringify([
        BASE_POEM,
        {
          ...BASE_POEM,
          sourceId: 'dryrun-002',
          sourceUrl: 'https://gutenberg.org/poem/dryrun-002',
        },
      ]),
    );
    info('Wrote 2 valid poems to dryrun.json');

    const summary = await runCleanStage({
      stage: 'clean',
      dryRun: true,
      includeNonPd: false,
      limit: undefined,
      inputDir,
      workDir,
    });

    info(
      `Summary: read=${summary.read} valid=${summary.valid} skipped=${summary.skipped} written=${summary.written}`,
    );

    if (summary.written !== 0) {
      return {
        status: 'fail',
        output: JSON.stringify(summary, null, 2),
        expected: 'written=0 in dry-run mode',
        notes: `written was ${summary.written} — dry-run should suppress all file writes`,
      };
    }

    // Also verify no NDJSON file was created in the output directory
    const cleanDir = join(workDir, '01-clean');
    const outputFiles = await readdir(cleanDir).catch(() => []);
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
      output: `read=${summary.read} valid=${summary.valid} written=0 — no files created`,
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

section('Phase 2 Verification — ETL Pipeline Track (etl_pipeline_20260220)');
console.log(`  ${DIM}Repo root : ${REPO_ROOT}${RESET}`);
console.log(`  ${DIM}Timestamp : ${new Date().toISOString()}${RESET}`);
console.log(`  ${DIM}Subject   : Stage 1 — Clean (01-clean.ts)${RESET}`);

try {
  await check1_automatedTests();
  const ndjsonPath = await check2_jsonInput();
  await check3_schemaValidation(ndjsonPath);
  await check4_ndjsonInput();
  await check5_invalidPoemsSkipped();
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
  console.log(`${GREEN}${BOLD}  ✓ All checks passed — Phase 2 verified.${RESET}\n`);
  process.exit(0);
}
