import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import fg from 'fast-glob';
import { z } from 'zod';
import type { CliConfig } from '../index';
import { CleanPoem, CleanPoemSchema } from './01-clean';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const DedupProvenanceSchema = z.object({
  sourceId: z.string().min(1),
  source: z.enum(['poets.org', 'poetry-foundation', 'loc-180', 'gutenberg']),
  sourceUrl: z.string().url(),
  isPublicDomain: z.boolean(),
  scrapedAt: z.string().min(1),
});

export const DedupPoemSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  year: z.string().nullable(),
  content: z.string().min(1),
  themes: z.array(z.string()),
  form: z.string().nullable(),
  provenances: z.array(DedupProvenanceSchema).min(1),
});

export type DedupProvenance = z.infer<typeof DedupProvenanceSchema>;
export type DedupPoem = z.infer<typeof DedupPoemSchema>;

// ---------------------------------------------------------------------------
// Normalization & Fuzzy Matching
// ---------------------------------------------------------------------------

/**
 * Normalizes strings for deduplication matching.
 * Applies case-folding, diacritic removal, punctuation collapse, whitespace collapse,
 * and strips leading articles ("the", "a", "an") to catch variants like
 * "The Raven" vs "Raven".
 */
export function normalizeDedupKey(text: string): string {
  let normalized = text
    .normalize('NFD') // decompose accents
    .replace(/[\u0300-\u036f]/g, '') // remove combining marks
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // remove punctuation
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();

  // Strip leading articles
  normalized = normalized.replace(/^(the|a|an)\s+/, '');

  return normalized;
}

/**
 * Computes the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Returns true if two normalized titles are fuzzy matches.
 * Rules:
 * 1. Exact match
 * 2. Suffix variants (e.g. " excerpt", " fragment")
 * 3. Small typos (Levenshtein distance <= 20% of length, max 3 edits, for strings >= 8 chars)
 */
export function isFuzzyMatch(normA: string, normB: string): boolean {
  if (normA === normB) return true;

  // Suffix checks
  const suffixes = ['excerpt', 'fragment', 'selection'];
  for (const suffix of suffixes) {
    if (normA === `${normB} ${suffix}` || normB === `${normA} ${suffix}`) {
      return true;
    }
  }

  // Levenshtein threshold for typos on longer strings
  const minLen = Math.min(normA.length, normB.length);
  if (minLen >= 8) {
    const dist = levenshteinDistance(normA, normB);
    const maxDist = Math.floor(minLen * 0.2); // Up to 20% different
    if (dist <= maxDist && dist <= 3) return true; // Cap at 3 absolute changes max
  }

  return false;
}

// ---------------------------------------------------------------------------
// Priority & Resolution
// ---------------------------------------------------------------------------

export const SOURCE_PRIORITY: Record<CleanPoem['source'], number> = {
  'poets.org': 4,
  'poetry-foundation': 3,
  'loc-180': 2,
  gutenberg: 1,
};

/**
 * Resolves a group of duplicate poems into a single canonical DedupPoem.
 * Retains all unique provenance entries.
 */
export function resolveDuplicates(group: CleanPoem[]): DedupPoem {
  if (group.length === 0) throw new Error('Cannot resolve empty group');

  // Sort by priority (highest first)
  const sorted = [...group].sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]);

  const canonical = sorted[0];

  // Collect provenances
  const provenances: DedupProvenance[] = sorted.map((p) => ({
    sourceId: p.sourceId,
    source: p.source,
    sourceUrl: p.sourceUrl,
    isPublicDomain: p.isPublicDomain,
    scrapedAt: p.scrapedAt,
  }));

  // Deduplicate provenances by sourceUrl
  const uniqueMap = new Map<string, DedupProvenance>();
  for (const p of provenances) {
    if (!uniqueMap.has(p.sourceUrl)) {
      uniqueMap.set(p.sourceUrl, p);
    }
  }

  return {
    title: canonical.title,
    author: canonical.author,
    year: canonical.year,
    content: canonical.content,
    themes: canonical.themes,
    form: canonical.form,
    provenances: Array.from(uniqueMap.values()),
  };
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

export interface DedupStageSummary {
  /** Total CleanPoem records read from all input files. */
  read: number;
  /** Total unique DedupPoem groups formed. */
  groups: number;
  /** Number of duplicates dropped. */
  duplicatesDropped: number;
  /** Unique DedupPoem records written to output. */
  written: number;
}

export async function runDedupStage(config: CliConfig): Promise<DedupStageSummary> {
  const inputDir = join(config.workDir, '01-clean');
  const outputDir = join(config.workDir, '02-dedup');

  await mkdir(outputDir, { recursive: true });

  const files = await fg('**/*.ndjson', {
    cwd: inputDir,
    absolute: true,
  });

  const summary: DedupStageSummary = { read: 0, groups: 0, duplicatesDropped: 0, written: 0 };

  // Map of normalizedAuthor -> array of poems
  const authorGroups = new Map<string, CleanPoem[]>();

  // 1. Read all poems and group by normalized author
  outer: for (const filePath of files) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (config.limit !== undefined && summary.read >= config.limit) {
        rl.close();
        break outer;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const raw = JSON.parse(trimmed);
        const parsed = CleanPoemSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`[dedup] Skipping invalid CleanPoem in ${basename(filePath)}`);
          continue;
        }

        const poem = parsed.data;
        summary.read++;

        const authorKey = normalizeDedupKey(poem.author);
        let group = authorGroups.get(authorKey);
        if (!group) {
          group = [];
          authorGroups.set(authorKey, group);
        }
        group.push(poem);
      } catch {
        console.warn(`[dedup] Skipping malformed JSON line in ${basename(filePath)}`);
      }
    }
  }

  // 2. Deduplicate within each author group
  const dedupedPoems: DedupPoem[] = [];

  for (const poems of authorGroups.values()) {
    // Array of arrays, where each inner array is a group of matched poems
    const titleGroups: CleanPoem[][] = [];

    for (const poem of poems) {
      const titleKey = normalizeDedupKey(poem.title);
      let matched = false;

      // Find a matching title group
      for (const group of titleGroups) {
        // Compare with the first poem in the group
        const groupTitleKey = normalizeDedupKey(group[0].title);
        if (isFuzzyMatch(titleKey, groupTitleKey)) {
          group.push(poem);
          matched = true;
          break;
        }
      }

      if (!matched) {
        titleGroups.push([poem]);
      }
    }

    // Resolve each title group into a single DedupPoem
    for (const group of titleGroups) {
      summary.groups++;
      summary.duplicatesDropped += group.length - 1;
      const resolved = resolveDuplicates(group);
      dedupedPoems.push(resolved);
    }
  }

  // 3. Write results
  if (!config.dryRun && dedupedPoems.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = join(outputDir, `dedup-${timestamp}.ndjson`);

    const fileHandle = await fs.promises.open(outFile, 'w');
    try {
      for (const p of dedupedPoems) {
        await fileHandle.write(JSON.stringify(p) + '\n');
        summary.written++;
      }
    } finally {
      await fileHandle.close();
    }
  } else if (config.dryRun) {
    console.log('[dedup] Dry-run mode — no files written.');
    summary.written = 0; // Or dedupedPoems.length depending on how we count for dry-runs, 0 is what 01-clean uses.
  }

  return summary;
}
