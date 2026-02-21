/**
 * Stage 1: Clean
 *
 * Validates raw ScrapedPoem records, normalizes text (Unicode NFC, whitespace,
 * HTML stripping), and emits CleanPoem records ready for deduplication.
 *
 * IO:
 *   Input  – JSON arrays of ScrapedPoem from --input-dir (default: packages/scraper/data/raw)
 *   Output – NDJSON of CleanPoem written to --work-dir/01-clean/
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import type { CliConfig } from '../index';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Runtime-validated shape for raw scraper output. */
export const ScrapedPoemSchema = z.object({
  sourceId: z.string().min(1),
  source: z.enum(['poets.org', 'poetry-foundation', 'loc-180', 'gutenberg']),
  sourceUrl: z.string().url(),
  title: z.string(),
  author: z.string(),
  year: z.string().nullable(),
  content: z.string(),
  themes: z.array(z.string()),
  form: z.string().nullable(),
  isPublicDomain: z.boolean(),
  scrapedAt: z.string().min(1),
});

/** Runtime-validated shape for a cleaned poem ready for deduplication. */
export const CleanPoemSchema = z.object({
  sourceId: z.string().min(1),
  source: z.enum(['poets.org', 'poetry-foundation', 'loc-180', 'gutenberg']),
  sourceUrl: z.string().url(),
  title: z.string().min(1),
  author: z.string().min(1),
  year: z.string().nullable(),
  content: z.string().min(1),
  themes: z.array(z.string()),
  form: z.string().nullable(),
  isPublicDomain: z.boolean(),
  scrapedAt: z.string().min(1),
});

export type ScrapedPoem = z.infer<typeof ScrapedPoemSchema>;
export type CleanPoem = z.infer<typeof CleanPoemSchema>;

// ---------------------------------------------------------------------------
// Named HTML entity map (covers the most common poetry-site artefacts)
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  hellip: '\u2026',
  copy: '\u00A9',
  reg: '\u00AE',
};

// ---------------------------------------------------------------------------
// Text normalization helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags and decode HTML entities from a string.
 *
 * This is intentionally defensive: the scraper should already emit plain
 * text, but residual markup can appear from rich-text sources.
 */
export function stripHtml(text: string): string {
  // Strip all HTML tags
  let result = text.replace(/<[^>]*>/g, '');

  // Decode named entities (&amp; &lt; …)
  result = result.replace(/&([a-zA-Z]+);/g, (match, name: string) => {
    return HTML_ENTITIES[name.toLowerCase()] ?? match;
  });

  // Decode decimal numeric entities (&#8212;)
  result = result.replace(/&#(\d+);/g, (_match, num: string) => {
    return String.fromCodePoint(parseInt(num, 10));
  });

  // Decode hex numeric entities (&#x2014;)
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => {
    return String.fromCodePoint(parseInt(hex, 16));
  });

  return result;
}

/**
 * Normalize whitespace in a poem text string.
 *
 * Rules applied (in order):
 *   1. CRLF → LF
 *   2. Tabs → single space
 *   3. Collapse horizontal whitespace runs within each line to one space
 *   4. Trim each line
 *   5. Collapse runs of 3+ newlines to exactly two newlines (stanza break)
 *   6. Trim leading/trailing whitespace from the whole text
 */
export function normalizeWhitespace(text: string): string {
  let result = text;

  // 1. CRLF → LF
  result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Tabs → space
  result = result.replace(/\t/g, ' ');

  // 3 & 4. Collapse spaces within each line and trim each line
  result = result
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n');

  // 5. Collapse runs of blank lines (3+ newlines) to exactly \n\n
  result = result.replace(/\n{3,}/g, '\n\n');

  // 6. Trim whole text
  result = result.trim();

  return result;
}

/**
 * Fully normalize a text field: Unicode NFC → strip HTML → normalize whitespace.
 */
export function normalizeText(text: string): string {
  return normalizeWhitespace(stripHtml(text.normalize('NFC')));
}

/**
 * Count the number of non-empty (non-blank) lines in a poem content string.
 *
 * Lines containing only whitespace are treated as empty.
 */
export function countNonEmptyLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').filter((line) => line.trim().length > 0).length;
}

// ---------------------------------------------------------------------------
// Per-poem validation and cleaning
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a single raw input record.
 *
 * Returns a `CleanPoem` on success, or `null` if the record is invalid.
 * Invalid records are silently skipped so callers can log and continue.
 */
export function validateAndClean(raw: unknown): CleanPoem | null {
  // Parse raw input against the scraper contract schema
  const parsed = ScrapedPoemSchema.safeParse(raw);
  if (!parsed.success) return null;

  const poem = parsed.data;

  // Normalize text fields
  const title = normalizeText(poem.title);
  const author = normalizeText(poem.author);
  const content = normalizeText(poem.content);

  // Hard validations post-normalization
  if (!title) return null;
  if (!content) return null;
  if (countNonEmptyLines(content) < 4) return null;

  return {
    // Provenance (preserved verbatim)
    sourceId: poem.sourceId,
    source: poem.source,
    sourceUrl: poem.sourceUrl,
    isPublicDomain: poem.isPublicDomain,
    scrapedAt: poem.scrapedAt,
    // Normalized text fields
    title,
    author,
    content,
    // Pass-through metadata
    year: poem.year,
    themes: poem.themes,
    form: poem.form,
  };
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

export interface CleanStageSummary {
  /** Total ScrapedPoem records read from all input files. */
  read: number;
  /** Records that passed validation and were normalized. */
  valid: number;
  /** Records rejected by validation (logged, not written). */
  skipped: number;
  /** Records written to the output directory. */
  written: number;
}

/**
 * Run the full clean stage:
 *   1. Discover input JSON files in `config.inputDir`.
 *   2. Parse, validate, and normalize each ScrapedPoem.
 *   3. Honour `config.limit` (cap total input records processed).
 *   4. Write CleanPoem records to `config.workDir/01-clean/` as NDJSON.
 *   5. Return a summary of counts.
 */
export async function runCleanStage(config: CliConfig): Promise<CleanStageSummary> {
  const outputDir = join(config.workDir, '01-clean');
  await mkdir(outputDir, { recursive: true });

  const files = await fg('**/*.{json,ndjson}', {
    cwd: config.inputDir,
    absolute: true,
  });

  const summary: CleanStageSummary = { read: 0, valid: 0, skipped: 0, written: 0 };
  const cleanPoems: CleanPoem[] = [];

  outer: for (const filePath of files) {
    const raw = await readFile(filePath, 'utf-8');
    let records: unknown[];

    // Support both JSON array and NDJSON
    if (filePath.endsWith('.ndjson')) {
      records = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
    } else {
      records = JSON.parse(raw) as unknown[];
      if (!Array.isArray(records)) {
        console.warn(`[clean] Skipping ${basename(filePath)}: not a JSON array`);
        continue;
      }
    }

    for (const record of records) {
      if (config.limit !== undefined && summary.read >= config.limit) break outer;

      summary.read++;
      const cleaned = validateAndClean(record);

      if (cleaned === null) {
        summary.skipped++;
        // Log enough context to identify the problematic record without halting
        const hint =
          typeof record === 'object' && record !== null
            ? ((record as Record<string, unknown>).sourceUrl ?? '(unknown url)')
            : '(unparseable record)';
        console.warn(`[clean] Skipped record from ${basename(filePath)}: ${hint}`);
      } else {
        summary.valid++;
        cleanPoems.push(cleaned);
      }
    }
  }

  if (!config.dryRun && cleanPoems.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = join(outputDir, `clean-${timestamp}.ndjson`);
    const ndjson = cleanPoems.map((p) => JSON.stringify(p)).join('\n');
    await writeFile(outFile, ndjson, 'utf-8');
    summary.written = cleanPoems.length;
  } else if (config.dryRun) {
    console.log('[clean] Dry-run mode — no files written.');
    summary.written = 0;
  }

  return summary;
}
