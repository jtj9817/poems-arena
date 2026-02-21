/**
 * Stage 4: Load
 *
 * Reads tagged poems from --work-dir/03-tag/ and loads them into the database
 * via Drizzle ORM. All writes are transactional and idempotent thanks to
 * deterministic ID generation.
 *
 * Operations per poem (inside a transaction):
 *   1. Upsert poem into `poems` (type = 'HUMAN').
 *   2. Refresh `poem_topics` associations (delete + insert).
 *   3. Upsert `scrape_sources` provenance rows.
 *
 * Canonical topics are upserted once at the start of the stage.
 *
 * IO:
 *   Input  – NDJSON of TagPoem from --work-dir/03-tag/
 *   Output – rows in the database (no file output)
 */

import { basename, join } from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import fg from 'fast-glob';
import { eq, sql } from 'drizzle-orm';
import type { CliConfig } from '../index';
import { TagPoemSchema, type TagPoem } from './03-tag';
import { generatePoemId, generateScrapeSourceId } from '../utils/id-gen';
import { CANONICAL_TOPICS, TOPIC_LABELS, type CanonicalTopic } from '../mappings/theme-to-topic';
import { poems, topics, poemTopics, scrapeSources } from '@sanctuary/db/schema';
import type { Db } from '@sanctuary/db/client';

// ---------------------------------------------------------------------------
// Stage summary
// ---------------------------------------------------------------------------

export interface LoadStageSummary {
  /** Total TagPoem records read from all input files. */
  read: number;
  /** Poems successfully loaded (upserted) into the database. */
  loaded: number;
  /** Poems skipped because all provenances are non-public-domain. */
  skippedNonPd: number;
  /** Number of canonical topics upserted at the start. */
  topicsUpserted: number;
}

// ---------------------------------------------------------------------------
// Topic upsert
// ---------------------------------------------------------------------------

/**
 * Upsert all 20 canonical topics into the `topics` table.
 * Uses INSERT … ON CONFLICT DO UPDATE to refresh labels idempotently.
 */
export async function upsertTopics(db: Db): Promise<number> {
  let count = 0;
  for (const id of CANONICAL_TOPICS) {
    const label = TOPIC_LABELS[id as CanonicalTopic];
    await db.insert(topics).values({ id, label }).onConflictDoUpdate({
      target: topics.id,
      set: { label },
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Single-poem loader
// ---------------------------------------------------------------------------

/**
 * Load a single TagPoem into the database within a transaction.
 *
 * 1. Upsert poem (deterministic ID, type = 'HUMAN').
 * 2. Delete existing poem_topics, then insert current associations.
 * 3. Upsert scrape_sources for each provenance entry.
 */
export async function loadPoem(db: Db, poem: TagPoem): Promise<string> {
  const poemId = generatePoemId(poem.title, poem.author);

  // Use the first provenance as the primary source info on the poem row
  const primaryProvenance = poem.provenances[0];

  await db.transaction(async (tx) => {
    // 1. Upsert poem
    await tx
      .insert(poems)
      .values({
        id: poemId,
        title: poem.title,
        content: poem.content,
        author: poem.author,
        type: 'HUMAN',
        year: poem.year ?? null,
        source: primaryProvenance.source,
        sourceUrl: primaryProvenance.sourceUrl,
        form: poem.form ?? null,
      })
      .onConflictDoUpdate({
        target: poems.id,
        set: {
          title: sql`excluded.title`,
          content: sql`excluded.content`,
          author: sql`excluded.author`,
          type: sql`excluded.type`,
          year: sql`excluded.year`,
          source: sql`excluded.source`,
          sourceUrl: sql`excluded.source_url`,
          form: sql`excluded.form`,
        },
      });

    // 2. Refresh poem_topics: delete existing, insert current
    await tx.delete(poemTopics).where(eq(poemTopics.poemId, poemId));
    for (const topicId of poem.topics) {
      await tx.insert(poemTopics).values({ poemId, topicId });
    }

    // 3. Upsert scrape_sources provenance
    for (const prov of poem.provenances) {
      const sourceId = generateScrapeSourceId(poemId, prov.source, prov.sourceUrl);
      await tx
        .insert(scrapeSources)
        .values({
          id: sourceId,
          poemId,
          source: prov.source,
          sourceUrl: prov.sourceUrl,
          scrapedAt: prov.scrapedAt,
          isPublicDomain: prov.isPublicDomain,
        })
        .onConflictDoUpdate({
          target: scrapeSources.id,
          set: {
            scrapedAt: sql`excluded.scraped_at`,
            isPublicDomain: sql`excluded.is_public_domain`,
          },
        });
    }
  });

  return poemId;
}

// ---------------------------------------------------------------------------
// Stage runner
// ---------------------------------------------------------------------------

/**
 * Run the full load stage:
 *   1. Upsert canonical topics into the database.
 *   2. Discover input NDJSON files in `config.workDir/03-tag`.
 *   3. Parse each TagPoem, filter by public-domain status, and load into DB.
 *   4. Honour `config.limit` and `config.dryRun`.
 *   5. Return a summary of counts.
 */
export async function runLoadStage(config: CliConfig, db: Db): Promise<LoadStageSummary> {
  const inputDir = join(config.workDir, '03-tag');

  const summary: LoadStageSummary = {
    read: 0,
    loaded: 0,
    skippedNonPd: 0,
    topicsUpserted: 0,
  };

  // 1. Upsert topics (skip in dry-run)
  if (!config.dryRun) {
    summary.topicsUpserted = await upsertTopics(db);
  } else {
    console.log('[load] Dry-run mode — no database writes.');
    summary.topicsUpserted = CANONICAL_TOPICS.length;
  }

  // 2. Discover input files
  const files = await fg('**/*.ndjson', {
    cwd: inputDir,
    absolute: true,
  });

  // 3. Process poems
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
        const parsed = TagPoemSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`[load] Skipping invalid TagPoem in ${basename(filePath)}`);
          continue;
        }

        summary.read++;
        const poem = parsed.data;

        // Filter non-public-domain poems unless --include-non-pd is set
        const hasPublicDomain = poem.provenances.some((p) => p.isPublicDomain);
        if (!hasPublicDomain && !config.includeNonPd) {
          summary.skippedNonPd++;
          continue;
        }

        // Load into DB (skip in dry-run)
        if (!config.dryRun) {
          await loadPoem(db, poem);
        }
        summary.loaded++;
      } catch {
        console.warn(`[load] Skipping malformed JSON line in ${basename(filePath)}`);
      }
    }
  }

  return summary;
}
