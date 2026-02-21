#!/usr/bin/env bun
/**
 * Phase 4 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Verifies Stage 3 — Tag (03-tag.ts):
 *   Check 1: ETL automated test suite passes
 *   Check 2: Tag stage reads dedup NDJSON input and writes tagged NDJSON output
 *   Check 3: Output NDJSON lines each pass TagPoem schema; topics array present
 *   Check 4: Theme-based topic assignment fires correctly (no keyword fallback)
 *   Check 5: Keyword fallback triggers for poems with empty themes
 *   Check 6: Topics capped at MAX_TOPICS (3)
 *   Check 7: Dry-run mode writes no output files
 *   Check 8: @sanctuary/etl typecheck passes
 *
 * Usage:
 *   bun scripts/verify-etl-phase-4.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

import { TagPoemSchema, runTagStage } from '../packages/etl/src/stages/03-tag';
import type { TagPoem } from '../packages/etl/src/stages/03-tag';

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

// Script lives at: scripts/verify-etl-phase-4.ts
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
 * Creates a work dir with the 02-dedup sub-directory already in place
 * (so the tag stage can glob for NDJSON files inside it).
 */
async function makeTagDirs(): Promise<{ workDir: string; dedupDir: string }> {
  const prefix = join(os.tmpdir(), 'etl-verify-phase4-');
  const workDir = await mkdtemp(prefix + 'work-');
  const dedupDir = join(workDir, '02-dedup');
  await mkdir(dedupDir, { recursive: true });
  tempDirs.push(workDir);
  return { workDir, dedupDir };
}

async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROV_GUTENBERG = (sourceId: string, sourceUrl: string) => ({
  sourceId,
  source: 'gutenberg' as const,
  sourceUrl,
  isPublicDomain: true,
  scrapedAt: '2026-02-01T10:00:00.000Z',
});

/** Poem A — themes map to 'nature' via THEME_TO_TOPIC. */
const POEM_A = {
  title: 'A Walk in the Forest',
  author: 'Robert Frost',
  year: '1923',
  content:
    'The pines stood still in morning light\nTheir shadows soft upon the ground\nA path wound through the ancient trees\nWhere birdsong was the only sound',
  themes: ['nature', 'seasons'],
  form: 'quatrain',
  provenances: [PROV_GUTENBERG('p4-001', 'https://gutenberg.org/poem/p4-001')],
};

/** Poem B — themes map to 'love'. */
const POEM_B = {
  title: "Love's First Light",
  author: 'John Keats',
  year: '1819',
  content:
    'She came to me at dawn so fair\nHer eyes alight with tender grace\nI found my heart beyond repair\nLost in the wonder of her face',
  themes: ['love', 'romance'],
  form: 'quatrain',
  provenances: [PROV_GUTENBERG('p4-002', 'https://gutenberg.org/poem/p4-002')],
};

/** Poem C — themes map to 'mortality'. */
const POEM_C = {
  title: 'The Final Hour',
  author: 'Emily Dickinson',
  year: '1890',
  content:
    'When death comes softly to the door\nAnd calls the soul to sleep\nThe body rests forevermore\nAs angels start to weep',
  themes: ['death', 'mortality'],
  form: 'quatrain',
  provenances: [PROV_GUTENBERG('p4-003', 'https://gutenberg.org/poem/p4-003')],
};

/** Poem X — no themes; keywords should match 'night' via keyword fallback. */
const POEM_X = {
  title: 'Moonlit Night',
  author: 'Anonymous',
  year: null,
  content:
    'The moon rose high above the trees\nStars shimmered in the evening breeze\nNight birds sang their hollow song\nThe darkness stretched the whole night long',
  themes: [] as string[],
  form: null,
  provenances: [PROV_GUTENBERG('p4-004', 'https://gutenberg.org/poem/p4-004')],
};

/** Poem Y — no themes; keywords should match 'the-sea' via keyword fallback. */
const POEM_Y = {
  title: 'Ode to the Sea',
  author: 'Anonymous',
  year: null,
  content:
    'The waves crash on the rocky shore\nThe ocean roars its endless roar\nSalt and spray fill the morning air\nThe sea in all its grandeur bare',
  themes: [] as string[],
  form: null,
  provenances: [PROV_GUTENBERG('p4-005', 'https://gutenberg.org/poem/p4-005')],
};

/** Poem Z — many themes that each map to a distinct canonical topic; cap test. */
const POEM_Z = {
  title: 'The Many Faces',
  author: 'Walt Whitman',
  year: '1855',
  content:
    'Of nature and of love and death\nOf war and faith and grief\nOf all the seasons and the sea\nOf joy and of belief',
  themes: ['nature', 'love', 'death', 'war', 'faith', 'grief'],
  form: null,
  provenances: [PROV_GUTENBERG('p4-006', 'https://gutenberg.org/poem/p4-006')],
};

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

// ── Check 2: Tag stage basic IO ───────────────────────────────────────────────

async function check2_basicIO(): Promise<string | null> {
  let outputNdjsonPath: string | null = null;

  await check(
    'Tag stage reads 02-dedup NDJSON input and writes tagged poems to 03-tag',
    async () => {
      const { workDir, dedupDir } = await makeTagDirs();
      info(`Work dir: ${workDir}`);

      const poems = [POEM_A, POEM_B, POEM_C];
      await writeFile(
        join(dedupDir, 'clean.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info(`Wrote ${poems.length} DedupPoem records to 02-dedup/clean.ndjson`);

      const summary = await runTagStage({
        stage: 'tag',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} tagged=${summary.tagged} fallback=${summary.fallback} written=${summary.written}`,
      );

      if (summary.read !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'read=3',
          notes: `read count mismatch: expected 3, got ${summary.read}`,
        };
      }
      if (summary.tagged !== 3) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'tagged=3 (all poems received at least one topic)',
          notes: `tagged mismatch: expected 3, got ${summary.tagged}`,
        };
      }
      if (summary.fallback !== 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'fallback=0 (all poems have mappable themes)',
          notes: `Unexpected keyword fallback for ${summary.fallback} poem(s)`,
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
      const tagDir = join(workDir, '03-tag');
      const outputFiles = await readdir(tagDir).catch(() => []);
      const ndjsonFiles = outputFiles.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No .ndjson files found in 03-tag/',
          expected: 'At least one tag-*.ndjson file in workDir/03-tag/',
        };
      }

      outputNdjsonPath = join(tagDir, ndjsonFiles[0]);
      return {
        status: 'pass',
        output: `${ndjsonFiles[0]} — read=3 tagged=3 fallback=0 written=3`,
      };
    },
  );

  return outputNdjsonPath;
}

// ── Check 3: TagPoem schema + topics array present ────────────────────────────

async function check3_schemaValidation(ndjsonPath: string | null) {
  await check(
    'Output NDJSON lines pass TagPoem schema; topics array is present on every poem',
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
          expected: '3 schema-valid TagPoem lines',
        };
      }

      const lines = rawContent
        .trim()
        .split('\n')
        .filter((l) => l.trim());

      const failures: string[] = [];
      const parsed: TagPoem[] = [];

      for (let i = 0; i < lines.length; i++) {
        let json: unknown;
        try {
          json = JSON.parse(lines[i]);
        } catch {
          failures.push(`Line ${i + 1}: invalid JSON`);
          continue;
        }

        const result = TagPoemSchema.safeParse(json);
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
          expected: 'All lines pass TagPoemSchema validation',
        };
      }

      // Every poem must have a topics array (may be empty for unresolvable poems,
      // but the schema must be present and valid)
      const missingTopics = parsed.filter((p) => !Array.isArray(p.topics));
      if (missingTopics.length > 0) {
        return {
          status: 'fail',
          output: `${missingTopics.length} poem(s) are missing the topics array`,
          expected: 'Every TagPoem has a topics field',
        };
      }

      const topicCounts = parsed.map((p) => p.topics.length);
      return {
        status: 'pass',
        output: `${parsed.length}/${lines.length} lines validated; topic counts: [${topicCounts.join(', ')}]`,
      };
    },
  );
}

// ── Check 4: Theme-based topic assignment (no fallback) ───────────────────────

async function check4_themeAssignment() {
  await check(
    'Theme-based assignment: nature/seasons→nature, love/romance→love, death/mortality→mortality',
    async () => {
      const { workDir, dedupDir } = await makeTagDirs();
      info(`Work dir: ${workDir}`);

      const poems = [POEM_A, POEM_B, POEM_C];
      await writeFile(
        join(dedupDir, 'themes.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 3 poems with distinct theme sets to 02-dedup/themes.ndjson');

      const summary = await runTagStage({
        stage: 'tag',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} tagged=${summary.tagged} fallback=${summary.fallback} written=${summary.written}`,
      );

      if (summary.fallback !== 0) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'fallback=0 (all poems have directly mappable themes)',
          notes: `${summary.fallback} poem(s) unexpectedly fell back to keyword extraction`,
        };
      }

      // Read output and verify per-poem topic assignments
      const tagDir = join(workDir, '03-tag');
      const files = await readdir(tagDir).catch(() => []);
      const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No output file found in 03-tag/',
          expected: 'A tag-*.ndjson file with 3 poems',
        };
      }

      const content = await readFile(join(tagDir, ndjsonFiles[0]), 'utf-8');
      const taggedPoems = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as TagPoem);

      // Build a map by title for easy lookup
      const byTitle = new Map(taggedPoems.map((p) => [p.title, p.topics]));

      const checks: Array<{ title: string; expectedTopic: string }> = [
        { title: POEM_A.title, expectedTopic: 'nature' },
        { title: POEM_B.title, expectedTopic: 'love' },
        { title: POEM_C.title, expectedTopic: 'mortality' },
      ];

      const mismatches: string[] = [];
      for (const { title, expectedTopic } of checks) {
        const topics = byTitle.get(title);
        if (!topics) {
          mismatches.push(`"${title}" not found in output`);
        } else if (!topics.includes(expectedTopic as never)) {
          mismatches.push(
            `"${title}" expected topic "${expectedTopic}" but got [${topics.join(', ')}]`,
          );
        }
      }

      if (mismatches.length > 0) {
        return {
          status: 'fail',
          output: mismatches.join('\n'),
          expected: 'Each poem contains the expected canonical topic derived from its themes array',
        };
      }

      const report = checks
        .map(({ title, expectedTopic }) => `"${title}" → ${expectedTopic} ✓`)
        .join('; ');
      return {
        status: 'pass',
        output: `fallback=0; ${report}`,
      };
    },
  );
}

// ── Check 5: Keyword fallback for poems with empty themes ─────────────────────

async function check5_keywordFallback() {
  await check(
    'Keyword fallback fires for poems with empty themes; topics still assigned',
    async () => {
      const { workDir, dedupDir } = await makeTagDirs();
      info(`Work dir: ${workDir}`);

      const poems = [POEM_X, POEM_Y];
      await writeFile(
        join(dedupDir, 'fallback.ndjson'),
        poems.map((p) => JSON.stringify(p)).join('\n') + '\n',
      );
      info('Wrote 2 poems with themes=[] to 02-dedup/fallback.ndjson');
      info(`  Poem X: "${POEM_X.title}" — expects keyword hit on 'night'`);
      info(`  Poem Y: "${POEM_Y.title}" — expects keyword hit on 'the-sea'`);

      const summary = await runTagStage({
        stage: 'tag',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} tagged=${summary.tagged} fallback=${summary.fallback} written=${summary.written}`,
      );

      if (summary.fallback !== 2) {
        return {
          status: 'fail',
          output: JSON.stringify(summary, null, 2),
          expected: 'fallback=2 (both poems have empty themes and must use keyword fallback)',
          notes: `fallback count was ${summary.fallback}`,
        };
      }

      // Verify both poems actually received topics
      const tagDir = join(workDir, '03-tag');
      const files = await readdir(tagDir).catch(() => []);
      const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No output file found in 03-tag/',
          expected: 'A tag-*.ndjson file with 2 poems',
        };
      }

      const content = await readFile(join(tagDir, ndjsonFiles[0]), 'utf-8');
      const taggedPoems = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as TagPoem);

      const withoutTopics = taggedPoems.filter((p) => p.topics.length === 0);
      if (withoutTopics.length > 0) {
        return {
          status: 'fail',
          output: `${withoutTopics.length} poem(s) have 0 topics after keyword fallback: ${withoutTopics.map((p) => `"${p.title}"`).join(', ')}`,
          expected: 'Every poem receives ≥1 topic via keyword extraction',
        };
      }

      const report = taggedPoems.map((p) => `"${p.title}" → [${p.topics.join(', ')}]`).join('; ');
      return {
        status: 'pass',
        output: `fallback=2; ${report}`,
      };
    },
  );
}

// ── Check 6: Topics capped at MAX_TOPICS (3) ─────────────────────────────────

async function check6_topicsCap() {
  await check(
    'Topics capped at MAX_TOPICS (3) even when themes map to many distinct topics',
    async () => {
      const { workDir, dedupDir } = await makeTagDirs();
      info(`Work dir: ${workDir}`);

      await writeFile(join(dedupDir, 'cap.ndjson'), JSON.stringify(POEM_Z) + '\n');
      info(`Wrote poem with themes=[${POEM_Z.themes.join(', ')}] to 02-dedup/cap.ndjson`);
      info('Expects assignTopics to cap output at 3 topics');

      const summary = await runTagStage({
        stage: 'tag',
        dryRun: false,
        includeNonPd: false,
        limit: undefined,
        inputDir: join(workDir, '00-raw'),
        workDir,
      });

      info(
        `Summary: read=${summary.read} tagged=${summary.tagged} fallback=${summary.fallback} written=${summary.written}`,
      );

      // Read the output and inspect the topics array length
      const tagDir = join(workDir, '03-tag');
      const files = await readdir(tagDir).catch(() => []);
      const ndjsonFiles = files.filter((f) => f.endsWith('.ndjson'));

      if (ndjsonFiles.length === 0) {
        return {
          status: 'fail',
          output: 'No output file found in 03-tag/',
          expected: 'A tag-*.ndjson file with 1 poem',
        };
      }

      const content = await readFile(join(tagDir, ndjsonFiles[0]), 'utf-8');
      const poem = JSON.parse(content.trim()) as TagPoem;

      if (poem.topics.length > 3) {
        return {
          status: 'fail',
          output: `topics.length=${poem.topics.length} — topics: [${poem.topics.join(', ')}]`,
          expected: 'topics.length ≤ 3 (MAX_TOPICS cap enforced)',
          notes: 'assignTopics must cap the returned list before writing',
        };
      }

      if (poem.topics.length === 0) {
        return {
          status: 'fail',
          output: 'topics.length=0 — poem received no topic assignments',
          expected: 'topics.length between 1 and 3',
        };
      }

      return {
        status: 'pass',
        output: `topics.length=${poem.topics.length} ≤ 3 — [${poem.topics.join(', ')}]`,
      };
    },
  );
}

// ── Check 7: Dry-run writes no files ─────────────────────────────────────────

async function check7_dryRun() {
  await check('Dry-run mode writes no output files (written === 0)', async () => {
    const { workDir, dedupDir } = await makeTagDirs();
    info(`Work dir: ${workDir}`);

    await writeFile(
      join(dedupDir, 'dryrun.ndjson'),
      [POEM_A, POEM_B].map((p) => JSON.stringify(p)).join('\n') + '\n',
    );
    info('Wrote 2 poems to 02-dedup/dryrun.ndjson');

    const summary = await runTagStage({
      stage: 'tag',
      dryRun: true,
      includeNonPd: false,
      limit: undefined,
      inputDir: join(workDir, '00-raw'),
      workDir,
    });

    info(`Summary: read=${summary.read} tagged=${summary.tagged} written=${summary.written}`);

    if (summary.written !== 0) {
      return {
        status: 'fail',
        output: JSON.stringify(summary, null, 2),
        expected: 'written=0 in dry-run mode',
        notes: `written was ${summary.written} — dry-run should suppress all file writes`,
      };
    }

    // Verify no NDJSON file was created
    const tagDir = join(workDir, '03-tag');
    const outputFiles = await readdir(tagDir).catch(() => []);
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
      output: `read=${summary.read} tagged=${summary.tagged} written=0 — no files created`,
    };
  });
}

// ── Check 8: Typecheck ────────────────────────────────────────────────────────

async function check8_typecheck() {
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

section('Phase 4 Verification — ETL Pipeline Track (etl_pipeline_20260220)');
console.log(`  ${DIM}Repo root : ${REPO_ROOT}${RESET}`);
console.log(`  ${DIM}Timestamp : ${new Date().toISOString()}${RESET}`);
console.log(`  ${DIM}Subject   : Stage 3 — Tag (03-tag.ts)${RESET}`);

try {
  await check1_automatedTests();
  const ndjsonPath = await check2_basicIO();
  await check3_schemaValidation(ndjsonPath);
  await check4_themeAssignment();
  await check5_keywordFallback();
  await check6_topicsCap();
  await check7_dryRun();
  await check8_typecheck();
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
  console.log(`${GREEN}${BOLD}  ✓ All checks passed — Phase 4 verified.${RESET}\n`);
  process.exit(0);
}
