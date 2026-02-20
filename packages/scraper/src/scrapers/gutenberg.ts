import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import { extractTagMatches, normalizeWhitespace, stripHtml } from '../utils/html';

export const GUTENBERG_EMERSON_URL = 'https://www.gutenberg.org/files/12843/12843-h/12843-h.htm';

const EMERSON_AUTHOR = 'Ralph Waldo Emerson';
const EXCLUDED_HEADINGS = new Set(['contents', 'notes', 'preface', 'appendix']);

export interface GutenbergScraperOptions {
  fetchImpl?: typeof fetch;
}

function isPoemHeading(title: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  return normalizedTitle.length > 0 && !EXCLUDED_HEADINGS.has(normalizedTitle);
}

function extractPoemsFromHtml(html: string, sourceUrl: string): ScrapedPoem[] {
  const headings = extractTagMatches(html, ['h2', 'h3']);
  const poems: ScrapedPoem[] = [];

  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const title = normalizeWhitespace(stripHtml(heading.innerHtml));

    if (!isPoemHeading(title)) {
      continue;
    }

    const nextHeading = headings[index + 1];
    const contentSlice = html.slice(heading.end, nextHeading ? nextHeading.start : undefined);
    const content = parsePoemContent(contentSlice);

    if (!content) {
      logger.debug('Skipping Gutenberg heading with empty content', { sourceUrl, title });
      continue;
    }

    poems.push({
      sourceId: generateSourceId('gutenberg', sourceUrl, title),
      source: 'gutenberg',
      sourceUrl,
      title,
      author: EMERSON_AUTHOR,
      year: null,
      content,
      themes: [],
      form: null,
      isPublicDomain: true,
      scrapedAt: new Date().toISOString(),
    });
  }

  return poems;
}

export async function scrapeGutenbergEmerson(
  url: string = GUTENBERG_EMERSON_URL,
  options: GutenbergScraperOptions = {},
): Promise<ScrapedPoem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startTimeMs = Date.now();
  logger.info('Starting Gutenberg scrape', { source: 'gutenberg', sourceUrl: url });

  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      logger.error('Failed to fetch Gutenberg source page', undefined, {
        source: 'gutenberg',
        sourceUrl: url,
        status: response.status,
        statusText: response.statusText,
      });
      return [];
    }

    const html = await response.text();
    const poems = extractPoemsFromHtml(html, url);
    logger.info('Completed Gutenberg scrape', {
      source: 'gutenberg',
      sourceUrl: url,
      poemCount: poems.length,
      durationMs: Date.now() - startTimeMs,
    });
    return poems;
  } catch (error) {
    logger.error('Unhandled Gutenberg scraping error', error, {
      source: 'gutenberg',
      sourceUrl: url,
      durationMs: Date.now() - startTimeMs,
    });
    return [];
  }
}
