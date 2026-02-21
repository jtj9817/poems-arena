import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ScrapedPoem } from '../types';

/**
 * Writes an array of scraped poems to a JSON file on disk.
 *
 * @param poems - The poems to write.
 * @param outputDir - Target directory (created if it does not exist).
 * @param source - Source identifier used in the file name (e.g. "gutenberg").
 * @returns The absolute path to the written file.
 */
export async function writeScrapedPoems(
  poems: ScrapedPoem[],
  outputDir: string,
  source: string,
): Promise<string> {
  const resolvedOutputDir = resolve(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });

  // Sanitize source to prevent path traversal
  const safeSource = basename(source);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${safeSource}-${timestamp}.json`;
  const filePath = join(resolvedOutputDir, fileName);

  writeFileSync(filePath, JSON.stringify(poems, null, 2), 'utf-8');

  return filePath;
}
