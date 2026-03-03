/**
 * fix-long-poems.ts
 *
 * One-time fixup script that:
 *   1. Deletes 2 non-poem editorial artefacts from the DB.
 *   2. Cleans, splits, LLM-verifies, and re-inserts 5 long poems as
 *      numbered part-poems, each under 4,000 characters.
 *
 * Usage:
 *   pnpm --filter @sanctuary/etl run fix-long-poems
 *   pnpm --filter @sanctuary/etl run fix-long-poems -- --dry-run
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { like } from 'drizzle-orm';

import { createDb } from '@sanctuary/db/client';
import { resolveDbConfig } from '@sanctuary/db/config';
import { poems, poemTopics, scrapeSources } from '@sanctuary/db/schema';
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

type PoemAction = 'delete' | 'split';

interface PoemTarget {
  prefix: string;
  action: PoemAction;
}

const POEM_TARGETS: PoemTarget[] = [
  { prefix: 'd87091e153a9', action: 'delete' },
  { prefix: 'f399fdc5e1ab', action: 'delete' },
  { prefix: '19176bc9d632', action: 'split' },
  { prefix: 'b45e1e960ad8', action: 'split' },
  { prefix: 'c8d1c4ef3331', action: 'split' },
  { prefix: '92273a10aba0', action: 'split' },
  { prefix: 'f49974a9f0b2', action: 'split' },
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

/** Clean stanzas then split content into parts under MAX_PART_CHARS. */
function cleanAndSplit(content: string): string[] {
  const rawStanzas = content.split(/\n{2,}/);

  const stanzas = rawStanzas.filter((s) => {
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
// Anthropic LLM verification
// ---------------------------------------------------------------------------

let _anthropicClient: Anthropic | null = null;

function getAnthropicClient(apiKey: string): Anthropic {
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey });
  }
  return _anthropicClient;
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
  const client = getAnthropicClient(apiKey);
  const romanNum = toRoman(partNum);

  const prompt = `You are verifying that a poem excerpt has clean boundaries after being split from a longer source poem.

Poem: "${title}" by ${author}
Part ${romanNum} of ${totalParts}:
---
${content}
---

Check whether this excerpt:
1. Begins at a clean verse or stanza boundary — the first line is the start of a complete thought or verse unit, not a mid-stanza continuation.
2. Ends at a clean verse or stanza boundary — the last line concludes a complete thought or verse unit, not cut off mid-stanza.
3. Contains no truncation artefacts — no mid-word breaks, no orphaned half-lines.

Respond ONLY with JSON:
{"valid": true | false, "issue": null | "<brief description of the problem>"}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';

  // Extract JSON (tolerate markdown code fences in response)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
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

async function fetchPoem(db: Db, prefix: string): Promise<PoemRow | null> {
  const rows = await db
    .select()
    .from(poems)
    .where(like(poems.id, `${prefix}%`));
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

async function fetchTopicIds(db: Db, prefix: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(poemTopics)
    .where(like(poemTopics.poemId, `${prefix}%`));
  return rows.map((r) => r.topicId);
}

async function fetchSourceRows(db: Db, prefix: string): Promise<ScrapeSourceRow[]> {
  const rows = await db
    .select()
    .from(scrapeSources)
    .where(like(scrapeSources.poemId, `${prefix}%`));
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

async function deleteOriginal(db: Db, prefix: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(poemTopics).where(like(poemTopics.poemId, `${prefix}%`));
    await tx.delete(scrapeSources).where(like(scrapeSources.poemId, `${prefix}%`));
    await tx.delete(poems).where(like(poems.id, `${prefix}%`));
  });
}

async function insertSplitPoems(
  db: Db,
  original: PoemRow,
  originalPrefix: string,
  parts: string[],
  topicIds: string[],
  sourceRows: ScrapeSourceRow[],
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

    // Delete the original poem
    await tx.delete(poemTopics).where(like(poemTopics.poemId, `${originalPrefix}%`));
    await tx.delete(scrapeSources).where(like(scrapeSources.poemId, `${originalPrefix}%`));
    await tx.delete(poems).where(like(poems.id, `${originalPrefix}%`));
  });
}

// ---------------------------------------------------------------------------
// Per-target handlers
// ---------------------------------------------------------------------------

async function processDelete(prefix: string, db: Db, dryRun: boolean): Promise<void> {
  const poem = await fetchPoem(db, prefix);
  if (!poem) {
    console.log(`[DELETE] ${prefix} — (not found in DB, skipping)`);
    return;
  }

  console.log(`[DELETE] ${prefix} — ${poem.title} (${poem.author})`);

  if (!dryRun) {
    await deleteOriginal(db, prefix);
    console.log(`  ✓ Deleted`);
  }
}

async function processSplit(
  prefix: string,
  db: Db,
  dryRun: boolean,
  anthropicApiKey: string,
): Promise<void> {
  const poem = await fetchPoem(db, prefix);
  if (!poem) {
    console.log(`\n[SPLIT] ${prefix} — (not found in DB, skipping)`);
    return;
  }

  const parts = cleanAndSplit(poem.content);

  console.log(`\n[SPLIT] ${prefix} — ${poem.title} (${poem.author})`);
  for (let i = 0; i < parts.length; i++) {
    const roman = toRoman(i + 1);
    const chars = parts[i].length;
    const lines = lineCount(parts[i]);
    const pad = ' '.repeat(Math.max(1, 4 - roman.length));
    console.log(`  → (${roman})${pad}${chars} chars  ${lines} lines`);
  }

  if (dryRun) return;

  // LLM verification — sequential calls (23 total across all poems)
  console.log(`  Verifying ${parts.length} parts via Claude Haiku…`);
  let allValid = true;

  for (let i = 0; i < parts.length; i++) {
    const roman = toRoman(i + 1);
    let result: VerifyResult;

    try {
      result = await verifyPart(
        anthropicApiKey,
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

  // Fetch topics and sources to copy alongside the new parts
  const topicIds = await fetchTopicIds(db, prefix);
  const sourceRows = await fetchSourceRows(db, prefix);

  await insertSplitPoems(db, poem, prefix, parts, topicIds, sourceRows);
  console.log(`  ✓ Inserted ${parts.length} parts, deleted original`);
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

  // Load .env from the ETL package root (needed for DB + Anthropic API key)
  loadEnv({ path: resolve(PKG_ROOT, '.env') });

  // DB is needed in both dry-run (for reading poem content) and live mode
  const db = createDb(resolveDbConfig());

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!dryRun && !anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required (set in packages/etl/.env)',
    );
  }

  for (const target of POEM_TARGETS) {
    if (target.action === 'delete') {
      await processDelete(target.prefix, db, dryRun);
    } else {
      await processSplit(target.prefix, db, dryRun, anthropicApiKey ?? '');
    }
  }

  console.log('\nDone.');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
