/**
 * fix-long-poems.ts
 *
 * One-time fixup script that:
 *   1. Cleans, splits, LLM-verifies, and re-inserts 5 long poems as
 *      numbered part-poems, each under 4,000 characters.
 *   2. Runs only against the 5 scoped poem IDs from
 *      docs/tickets/etl-long-poems-remediation-execution.md.
 *
 * Usage:
 *   pnpm --filter @sanctuary/etl run fix-long-poems
 *   pnpm --filter @sanctuary/etl run fix-long-poems -- --dry-run
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import OpenAI from 'openai';
import { eq, or, inArray } from 'drizzle-orm';

import { createDb } from '@sanctuary/db/client';
import { resolveDbConfig } from '@sanctuary/db/config';
import {
  poems,
  poemTopics,
  scrapeSources,
  duels,
  votes,
  featuredDuels,
} from '@sanctuary/db/schema';
import type { Db } from '@sanctuary/db/client';
import { generatePoemId, generateScrapeSourceId } from './utils/id-gen';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PKG_ROOT = resolve(import.meta.dir, '..');
const MAX_PART_CHARS = 4000;
const MIN_PART_LINES = 20;

// ---------------------------------------------------------------------------
// Poem targets
// ---------------------------------------------------------------------------

interface PoemTarget {
  poemId: string;
  /**
   * For poems stored with \n\n between every individual line (no \n within stanzas):
   * the number of lines per stanza. Used to reassemble proper stanzas before packing.
   * Only needed when the poem has no Roman numeral section headers.
   */
  stanzaLines?: number;
}

export const POEM_TARGETS: readonly PoemTarget[] = [
  { poemId: '19176bc9d632', stanzaLines: 6 }, // Ballad: 6-line stanzas within sections I–VI
  { poemId: 'b45e1e960ad8' }, // MAY-DAY
  { poemId: '92273a10aba0' }, // MONADNOC
  { poemId: 'c8d1c4ef3331' }, // THE ADIRONDACS
  { poemId: 'f399fdc5e1ab' }, // FRAGMENTS ON THE POET AND THE POETIC GIFT
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  let result = '';
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

/** Strip stanzas that are standalone Roman numeral section headers. */
function isRomanNumeralHeader(stanza: string): boolean {
  return /^[IVXLCDM]+\.?$/.test(stanza.trim());
}

/** Strip single-line ALL-CAPS editorial headers of ≤ 80 chars. */
function isEditorialHeader(stanza: string): boolean {
  const lines = stanza.trim().split('\n');
  if (lines.length !== 1) return false;
  const line = lines[0].trim();
  return line.length <= 80 && line === line.toUpperCase() && /[A-Z]/.test(line);
}

/**
 * Split a poem whose content uses Roman numeral section headers (e.g. "I", "II"…)
 * as section delimiters.
 *
 * Each section's individual lines (all-\n\n format) are first reassembled into
 * proper stanzas of `stanzaLines` lines each, joined with \n within a stanza
 * and \n\n between stanzas. Stanzas are then packed greedily into parts under
 * MAX_PART_CHARS.
 *
 * Used for: The Ballad of Reading Gaol (6-line stanzas within sections I–VI).
 */
function splitAtRomanSections(chunks: string[], stanzaLines: number): string[] {
  const sections: string[][] = [];
  let cur: string[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (isRomanNumeralHeader(trimmed)) {
      if (cur.length > 0) {
        sections.push(cur);
        cur = [];
      }
    } else if (!isEditorialHeader(trimmed)) {
      cur.push(trimmed);
    }
  }
  if (cur.length > 0) sections.push(cur);

  const parts: string[] = [];
  for (const section of sections) {
    // Reassemble individual lines into stanzas of stanzaLines lines
    const stanzas: string[] = [];
    for (let i = 0; i < section.length; i += stanzaLines) {
      stanzas.push(section.slice(i, i + stanzaLines).join('\n'));
    }

    // Greedy-pack stanzas into parts under MAX_PART_CHARS
    let curStanzas: string[] = [];
    let curLen = 0;
    for (const stanza of stanzas) {
      const stanzaLen = stanza.length + 2;
      if (curLen + stanzaLen > MAX_PART_CHARS && curStanzas.length > 0) {
        parts.push(curStanzas.join('\n\n'));
        curStanzas = [stanza];
        curLen = stanzaLen;
      } else {
        curStanzas.push(stanza);
        curLen += stanzaLen;
      }
    }
    if (curStanzas.length > 0) parts.push(curStanzas.join('\n\n'));
  }

  // Tail-merge: if the last part is too short, fold into second-to-last
  if (parts.length > 1 && lineCount(parts[parts.length - 1]) < MIN_PART_LINES) {
    parts[parts.length - 2] = parts[parts.length - 2] + '\n\n' + parts[parts.length - 1];
    parts.pop();
  }

  return parts;
}

/**
 * Split a poem stored in "all-\n\n" format (every individual line separated
 * by \n\n, no \n within stanzas) by first reassembling stanzas of a fixed
 * line count, then packing stanzas greedily under MAX_PART_CHARS.
 *
 * Used for: poems where each logical stanza has a fixed line count.
 */
function splitByFixedLineCount(chunks: string[], stanzaLines: number): string[] {
  const lines = chunks
    .map((c) => c.trim())
    .filter((c) => c && !isRomanNumeralHeader(c) && !isEditorialHeader(c));

  // Reassemble into proper stanzas
  const stanzas: string[] = [];
  for (let i = 0; i < lines.length; i += stanzaLines) {
    stanzas.push(lines.slice(i, i + stanzaLines).join('\n'));
  }

  // Greedy pack
  const parts: string[] = [];
  let cur: string[] = [];
  let curLen = 0;

  for (const stanza of stanzas) {
    const stanzaLen = stanza.length + 2;
    if (curLen + stanzaLen > MAX_PART_CHARS && cur.length > 0) {
      parts.push(cur.join('\n\n'));
      cur = [stanza];
      curLen = stanzaLen;
    } else {
      cur.push(stanza);
      curLen += stanzaLen;
    }
  }
  if (cur.length > 0) parts.push(cur.join('\n\n'));

  // Tail-merge
  if (parts.length > 1 && lineCount(parts[parts.length - 1]) < MIN_PART_LINES) {
    parts[parts.length - 2] = parts[parts.length - 2] + '\n\n' + parts[parts.length - 1];
    parts.pop();
  }

  return parts;
}

/**
 * Clean stanzas then split content into parts under MAX_PART_CHARS.
 *
 * Handles three content formats:
 *   1. All-\n\n with Roman numeral section headers → split at sections.
 *   2. All-\n\n without section headers → reassemble stanzas from fixed line count.
 *   3. Normal \n / \n\n format → split at \n\n stanza/paragraph boundaries.
 */
export function cleanAndSplit(content: string, stanzaLines?: number): string[] {
  const rawChunks = content.split(/\n{2,}/);

  // Detect "all-double-newline" format: every line is its own chunk (no \n within chunks)
  const isAllDoubleNewline = rawChunks.every((c) => !c.includes('\n'));

  if (isAllDoubleNewline) {
    const hasRomanSections = rawChunks.some((c) => isRomanNumeralHeader(c.trim()));
    if (hasRomanSections) {
      return splitAtRomanSections(rawChunks, stanzaLines ?? 6);
    }
    return splitByFixedLineCount(rawChunks, stanzaLines ?? 9);
  }

  // Normal format: stanzas separated by \n\n, lines within stanzas by \n
  const stanzas = rawChunks.filter((s) => {
    const trimmed = s.trim();
    if (!trimmed) return false;
    if (isRomanNumeralHeader(trimmed)) return false;
    if (isEditorialHeader(trimmed)) return false;
    return true;
  });

  const parts: string[] = [];
  let cur: string[] = [];
  let curLen = 0;

  for (const stanza of stanzas) {
    const stanzaLen = stanza.length + 2; // +2 for the \n\n separator between stanzas
    if (curLen + stanzaLen > MAX_PART_CHARS && cur.length > 0) {
      parts.push(cur.join('\n\n'));
      cur = [stanza];
      curLen = stanzaLen;
    } else {
      cur.push(stanza);
      curLen += stanzaLen;
    }
  }

  if (cur.length > 0) {
    parts.push(cur.join('\n\n'));
  }

  // Merge tiny tails: if the last part has fewer than MIN_PART_LINES, fold into second-to-last
  if (parts.length > 1 && lineCount(parts[parts.length - 1]) < MIN_PART_LINES) {
    parts[parts.length - 2] = parts[parts.length - 2] + '\n\n' + parts[parts.length - 1];
    parts.pop();
  }

  return parts;
}

// ---------------------------------------------------------------------------
// DeepSeek LLM verification
// ---------------------------------------------------------------------------

let _deepSeekClient: OpenAI | null = null;

function getDeepSeekClient(apiKey: string): OpenAI {
  if (!_deepSeekClient) {
    _deepSeekClient = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
      timeout: 30_000,
      maxRetries: 2,
    });
  }
  return _deepSeekClient;
}

interface VerifyResult {
  valid: boolean;
  issue: string | null;
}

async function verifyPart(
  apiKey: string,
  title: string,
  author: string,
  content: string,
  partNum: number,
  totalParts: number,
): Promise<VerifyResult> {
  const client = getDeepSeekClient(apiKey);
  const romanNum = toRoman(partNum);

  const prompt = `You are verifying that a poem excerpt has clean STRUCTURAL boundaries after being mechanically split from a longer source poem.

Poem: "${title}" by ${author}
Part ${romanNum} of ${totalParts}:
---
${content}
---

Verify ONLY structural integrity (do NOT evaluate thematic or argumentative completeness):

1. Begins at a structural start — the first line is NOT mid-sentence and is NOT an obvious syntactic continuation that only makes sense with the immediately preceding line (e.g., a line beginning with a lowercase word that continues the previous sentence).
2. Ends at a structural boundary — the last line ends a complete sentence (ends with sentence-final punctuation: . ! ? or —) OR ends a complete verse unit (the final line of a stanza or rhyming couplet).
3. No truncation artefacts — no mid-word breaks, no orphaned half-lines.

IMPORTANT: It is expected and acceptable that the thematic content is incomplete — each part covers only a section of the full poem. Only mark as INVALID if there is a genuine mid-sentence syntactic cut or an obvious structural fracture. Do NOT mark invalid solely because the ideas or argument continue in the next part.

Respond ONLY with JSON (no markdown code fences):
{"valid": true | false, "issue": null | "<brief specific description of the structural problem>"}

Respond in JSON format.`;

  const response = await client.chat.completions.create({
    model: 'deepseek-chat',
    max_tokens: 256,
    temperature: 1,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.choices[0]?.message?.content?.trim() ?? '';
  if (!responseText) {
    throw new Error('DeepSeek verification returned empty content');
  }

  const sanitized = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Extract JSON (tolerate markdown code fences in response)
  const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse verification response: ${responseText}`);
  }

  return JSON.parse(jsonMatch[0]) as VerifyResult;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface PoemRow {
  id: string;
  title: string;
  content: string;
  author: string;
  year: string | null;
  source: string | null;
  sourceUrl: string | null;
  form: string | null;
}

interface ScrapeSourceRow {
  id: string;
  poemId: string;
  source: string;
  sourceUrl: string;
  scrapedAt: string;
  rawHtml: string | null;
  isPublicDomain: boolean;
}

async function fetchPoem(db: Db, poemId: string): Promise<PoemRow | null> {
  const rows = await db.select().from(poems).where(eq(poems.id, poemId));
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    author: r.author,
    year: r.year ?? null,
    source: r.source ?? null,
    sourceUrl: r.sourceUrl ?? null,
    form: r.form ?? null,
  };
}

async function fetchTopicIds(db: Db, poemId: string): Promise<string[]> {
  const rows = await db.select().from(poemTopics).where(eq(poemTopics.poemId, poemId));
  return rows.map((r) => r.topicId);
}

async function fetchSourceRows(db: Db, poemId: string): Promise<ScrapeSourceRow[]> {
  const rows = await db.select().from(scrapeSources).where(eq(scrapeSources.poemId, poemId));
  return rows.map((r) => ({
    id: r.id,
    poemId: r.poemId,
    source: r.source,
    sourceUrl: r.sourceUrl,
    scrapedAt: r.scrapedAt,
    rawHtml: r.rawHtml ?? null,
    isPublicDomain: r.isPublicDomain ?? false,
  }));
}

async function fetchDuelIds(db: Db, poemId: string): Promise<string[]> {
  const rows = await db
    .select({ id: duels.id })
    .from(duels)
    .where(or(eq(duels.poemAId, poemId), eq(duels.poemBId, poemId)));
  return rows.map((r) => r.id);
}

async function insertSplitPoems(
  db: Db,
  original: PoemRow,
  parts: string[],
  topicIds: string[],
  sourceRows: ScrapeSourceRow[],
  duelIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < parts.length; i++) {
      const romanPart = toRoman(i + 1);
      const partTitle = `${original.title} (${romanPart})`;
      const partId = generatePoemId(partTitle, original.author);
      const content = parts[i];

      // 1. Insert poem part (INSERT OR IGNORE)
      await tx
        .insert(poems)
        .values({
          id: partId,
          title: partTitle,
          content,
          author: original.author,
          type: 'HUMAN',
          year: original.year,
          source: original.source,
          sourceUrl: original.sourceUrl,
          form: original.form,
        })
        .onConflictDoNothing();

      // 2. Copy poem_topics
      for (const topicId of topicIds) {
        await tx.insert(poemTopics).values({ poemId: partId, topicId }).onConflictDoNothing();
      }

      // 3. Copy scrape_sources
      for (const srcRow of sourceRows) {
        const srcId = generateScrapeSourceId(partId, srcRow.source, srcRow.sourceUrl);
        await tx
          .insert(scrapeSources)
          .values({
            id: srcId,
            poemId: partId,
            source: srcRow.source,
            sourceUrl: srcRow.sourceUrl,
            scrapedAt: srcRow.scrapedAt,
            rawHtml: srcRow.rawHtml,
            isPublicDomain: srcRow.isPublicDomain,
          })
          .onConflictDoNothing();
      }
    }

    // Delete the original poem (cascade: featured_duels → votes → duels → poem_topics → scrape_sources → poems)
    if (duelIds.length > 0) {
      await tx.delete(featuredDuels).where(inArray(featuredDuels.duelId, duelIds));
      await tx.delete(votes).where(inArray(votes.duelId, duelIds));
      await tx
        .delete(duels)
        .where(or(eq(duels.poemAId, original.id), eq(duels.poemBId, original.id)));
    }
    await tx.delete(votes).where(eq(votes.selectedPoemId, original.id));
    await tx.delete(poemTopics).where(eq(poemTopics.poemId, original.id));
    await tx.delete(scrapeSources).where(eq(scrapeSources.poemId, original.id));
    await tx.delete(poems).where(eq(poems.id, original.id));
  });
}

// ---------------------------------------------------------------------------
// Per-target handlers
// ---------------------------------------------------------------------------

async function processSplit(
  poemId: string,
  db: Db,
  dryRun: boolean,
  deepSeekApiKey: string,
  stanzaLines?: number,
): Promise<void> {
  const poem = await fetchPoem(db, poemId);
  if (!poem) {
    console.log(`\n[SPLIT] ${poemId} — (not found in DB, skipping)`);
    return;
  }

  const parts = cleanAndSplit(poem.content, stanzaLines);

  console.log(`\n[SPLIT] ${poemId} — ${poem.title} (${poem.author})`);
  for (let i = 0; i < parts.length; i++) {
    const roman = toRoman(i + 1);
    const chars = parts[i].length;
    const lines = lineCount(parts[i]);
    const pad = ' '.repeat(Math.max(1, 4 - roman.length));
    console.log(`  → (${roman})${pad}${chars} chars  ${lines} lines`);
  }

  if (dryRun) return;

  // LLM verification — sequential calls (one per split part)
  console.log(`  Verifying ${parts.length} parts via DeepSeek…`);
  let allValid = true;

  for (let i = 0; i < parts.length; i++) {
    const roman = toRoman(i + 1);
    let result: VerifyResult;

    try {
      result = await verifyPart(
        deepSeekApiKey,
        poem.title,
        poem.author,
        parts[i],
        i + 1,
        parts.length,
      );
    } catch (err) {
      console.log(
        `  ✗ Part (${roman}) verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      allValid = false;
      continue;
    }

    if (result.valid) {
      console.log(`  ✓ Part (${roman}) valid`);
    } else {
      console.log(`  ✗ Part (${roman}) INVALID: ${result.issue}`);
      console.log(`    Content preview:\n    ${parts[i].slice(0, 300).replace(/\n/g, '\n    ')}…`);
      allValid = false;
    }
  }

  if (!allValid) {
    console.log(
      `  ⚠ Skipping ${poem.title} — one or more parts failed LLM verification (see above)`,
    );
    return;
  }

  // Fetch topics, sources, and referencing duels to cascade-delete with the original
  const topicIds = await fetchTopicIds(db, poem.id);
  const sourceRows = await fetchSourceRows(db, poem.id);
  const duelIds = await fetchDuelIds(db, poem.id);

  if (duelIds.length > 0) {
    console.log(`  Cascading deletion of ${duelIds.length} duels referencing original…`);
  }

  await insertSplitPoems(db, poem, parts, topicIds, sourceRows, duelIds);
  console.log(
    `  ✓ Inserted ${parts.length} parts, deleted original (${duelIds.length} duels cascaded)`,
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  });

  const dryRun = values['dry-run'] ?? false;

  if (dryRun) {
    console.log('DRY RUN — no changes will be made\n');
  }

  // Load .env from the ETL package root (needed for DB + DeepSeek API key)
  loadEnv({ path: resolve(PKG_ROOT, '.env') });

  // DB is needed in both dry-run (for reading poem content) and live mode
  const db = createDb(resolveDbConfig());

  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  if (!dryRun && !deepSeekApiKey) {
    throw new Error('DEEPSEEK_API_KEY environment variable is required (set in packages/etl/.env)');
  }

  for (const target of POEM_TARGETS) {
    await processSplit(target.poemId, db, dryRun, deepSeekApiKey ?? '', target.stanzaLines);
  }

  console.log('\nDone.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
