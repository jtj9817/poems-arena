/**
 * Stage 3: Tag
 *
 * Maps raw source themes from each DedupPoem to a canonical set of topic IDs
 * defined in CANONICAL_TOPICS. Poems without any mappable theme fall back to
 * keyword extraction from their title and content.
 *
 * Topic assignment rules:
 *   - Only assign IDs from CANONICAL_TOPICS.
 *   - Deduplicate topic IDs before writing.
 *   - Cap the assigned list at MAX_TOPICS (3) to avoid noise.
 *   - Log a warning when keyword fallback is used.
 *
 * IO:
 *   Input  – NDJSON of DedupPoem from --work-dir/02-dedup/
 *   Output – NDJSON of TagPoem written to --work-dir/03-tag/
 */

import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import fg from 'fast-glob';
import { z } from 'zod';
import type { CliConfig } from '../index';
import { DedupPoemSchema } from './02-dedup';
import { CANONICAL_TOPICS, assignTopics } from '../mappings/theme-to-topic';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** A DedupPoem extended with an assigned list of canonical topic IDs. */
export const TagPoemSchema = DedupPoemSchema.extend({
  topics: z.array(z.enum(CANONICAL_TOPICS)).max(3),
});

export type TagPoem = z.infer<typeof TagPoemSchema>;

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

export interface TagStageSummary {
  /** Total DedupPoem records read from all input files. */
  read: number;
  /** Records that received at least one topic assignment. */
  tagged: number;
  /** Records whose topics were assigned via keyword fallback. */
  fallback: number;
  /** Records written to the output directory. */
  written: number;
}

/**
 * Run the full tag stage:
 *   1. Discover input NDJSON files in `config.workDir/02-dedup`.
 *   2. Parse each DedupPoem and assign canonical topics.
 *   3. Honour `config.limit` (cap total input records processed).
 *   4. Write TagPoem records to `config.workDir/03-tag/` as NDJSON.
 *   5. Return a summary of counts.
 */
export async function runTagStage(config: CliConfig): Promise<TagStageSummary> {
  const inputDir = join(config.workDir, '02-dedup');
  const outputDir = join(config.workDir, '03-tag');

  await mkdir(outputDir, { recursive: true });

  const files = await fg('**/*.ndjson', {
    cwd: inputDir,
    absolute: true,
  });

  const summary: TagStageSummary = { read: 0, tagged: 0, fallback: 0, written: 0 };

  let fileHandle: fs.promises.FileHandle | undefined;
  if (config.dryRun) {
    console.log('[tag] Dry-run mode — no files written.');
  }

  try {
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
          const parsed = DedupPoemSchema.safeParse(raw);
          if (!parsed.success) {
            console.warn(`[tag] Skipping invalid DedupPoem in ${basename(filePath)}`);
            continue;
          }

          summary.read++;
          const poem = parsed.data;

          const { topics, usedFallback } = assignTopics(poem.themes, poem.title, poem.content);

          if (usedFallback) {
            summary.fallback++;
            console.log(`[tag] Keyword fallback for "${poem.title}" by ${poem.author}`);
          }

          if (topics.length > 0) {
            summary.tagged++;
          }

          const tagPoem = { ...poem, topics };

          if (!config.dryRun) {
            if (!fileHandle) {
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const outFile = join(outputDir, `tag-${timestamp}.ndjson`);
              fileHandle = await fs.promises.open(outFile, 'w');
            }
            await fileHandle.write(JSON.stringify(tagPoem) + '\n');
            summary.written++;
          }
        } catch {
          console.warn(`[tag] Skipping malformed JSON line in ${basename(filePath)}`);
        }
      }
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }

  return summary;
}
