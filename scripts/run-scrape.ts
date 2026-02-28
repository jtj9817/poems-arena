#!/usr/bin/env bun
/**
 * Scraper Orchestration Script
 *
 * Calls all three poem scrapers and writes output to packages/scraper/data/raw/.
 *
 * Usage:
 *   bun scripts/run-scrape.ts
 *   bun scripts/run-scrape.ts --sources gutenberg
 *   bun scripts/run-scrape.ts --sources gutenberg,loc-180 --poets-org-pages 5
 *
 * Flags:
 *   --sources          Comma-separated list (default: gutenberg,loc-180,poets-org)
 *   --poets-org-pages  Max pages to scrape from Poets.org (default: 3)
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
// Use relative imports since @sanctuary/scraper lacks package.json exports
import { scrapeGutenbergEmerson } from '../packages/scraper/src/scrapers/gutenberg';
import { scrapeLoc180 } from '../packages/scraper/src/scrapers/loc-180';
import { scrapePoetsOrg } from '../packages/scraper/src/scrapers/poets-org';
import { writeScrapedPoems } from '../packages/scraper/src/utils/writer';
import { logger } from '../packages/scraper/src/utils/logger';

const VALID_SOURCES = ['gutenberg', 'loc-180', 'poets-org'] as const;
type Source = (typeof VALID_SOURCES)[number];

const OUTPUT_DIR = resolve(import.meta.dir, '..', 'packages', 'scraper', 'data', 'raw');

interface ScrapeResult {
  source: Source;
  count: number;
  filePath: string;
  elapsedMs: number;
}

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      sources: { type: 'string', default: 'gutenberg,loc-180,poets-org' },
      'poets-org-pages': { type: 'string', default: '3' },
    },
    strict: true,
  });

  const sources = (values.sources ?? 'gutenberg,loc-180,poets-org')
    .split(',')
    .map((s) => s.trim()) as Source[];

  for (const s of sources) {
    if (!VALID_SOURCES.includes(s)) {
      console.error(`Unknown source: "${s}". Valid sources: ${VALID_SOURCES.join(', ')}`);
      process.exit(1);
    }
  }

  return {
    sources,
    poetsOrgPages: parseInt(values['poets-org-pages'] ?? '3', 10),
  };
}

async function scrapeSource(source: Source, poetsOrgPages: number): Promise<ScrapeResult> {
  const start = performance.now();

  let poems;
  switch (source) {
    case 'gutenberg':
      logger.info('Scraping Gutenberg (Emerson)...');
      poems = await scrapeGutenbergEmerson();
      break;
    case 'loc-180':
      logger.info('Scraping LOC Poetry 180 (poems 1–180)...');
      poems = await scrapeLoc180(1, 180);
      break;
    case 'poets-org':
      logger.info(`Scraping Poets.org (${poetsOrgPages} pages)...`);
      poems = await scrapePoetsOrg(poetsOrgPages);
      break;
  }

  const filePath = await writeScrapedPoems(poems, OUTPUT_DIR, source);
  const elapsedMs = performance.now() - start;

  return { source, count: poems.length, filePath, elapsedMs };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- Main ---
const config = parseCliArgs();
const results: ScrapeResult[] = [];
const failures: { source: Source; error: string }[] = [];

console.log('');
console.log('@sanctuary/scraper — orchestration run');
console.log('─'.repeat(50));
console.log(`  Sources:         ${config.sources.join(', ')}`);
console.log(`  Poets.org pages: ${config.poetsOrgPages}`);
console.log(`  Output dir:      ${OUTPUT_DIR}`);
console.log('─'.repeat(50));

const pipelineStart = performance.now();

for (const source of config.sources) {
  try {
    const result = await scrapeSource(source, config.poetsOrgPages);
    results.push(result);
    logger.info(`Completed ${source}: ${result.count} poems in ${formatMs(result.elapsedMs)}`, {
      source,
      count: result.count,
      filePath: result.filePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push({ source, error: message });
    logger.error(`Failed to scrape ${source}: ${message}`, err);
  }
}

const totalElapsed = performance.now() - pipelineStart;

// --- Summary ---
console.log('');
console.log('═'.repeat(50));
console.log('  SCRAPE SUMMARY');
console.log('═'.repeat(50));

for (const r of results) {
  console.log(
    `  ✔ ${r.source.padEnd(12)} ${String(r.count).padStart(5)} poems  (${formatMs(r.elapsedMs)})`,
  );
}

for (const f of failures) {
  console.log(`  ✗ ${f.source.padEnd(12)} FAILED: ${f.error}`);
}

const totalPoems = results.reduce((sum, r) => sum + r.count, 0);
console.log('─'.repeat(50));
console.log(
  `  Total: ${totalPoems} poems from ${results.length}/${config.sources.length} sources in ${formatMs(totalElapsed)}`,
);
console.log('═'.repeat(50));

if (failures.length > 0) {
  process.exit(1);
}
