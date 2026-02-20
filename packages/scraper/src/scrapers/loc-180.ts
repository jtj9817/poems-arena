import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import { extractFirstClassInnerHtml, extractFirstTagText, removeTags } from '../utils/html';

const BASE_URL = 'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poetry-180/';

const limit = createRateLimiter({ concurrency: 5, minDelay: 200 });

export interface Loc180ScraperOptions {
  fetchImpl?: typeof fetch;
}

export async function scrapeLoc180(
  start: number = 1,
  end: number = 180,
  options: Loc180ScraperOptions = {},
): Promise<ScrapedPoem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startTimeMs = Date.now();
  logger.info('Starting LOC Poetry 180 scrape', {
    source: 'loc-180',
    poemStart: start,
    poemEnd: end,
  });

  const poemPromises: Promise<ScrapedPoem | null>[] = [];

  for (let i = start; i <= end; i++) {
    const poemNumber = i.toString().padStart(3, '0');
    const url = `${BASE_URL}${poemNumber}.html`;
    logger.debug('Queueing LOC poem scrape', { source: 'loc-180', poemNumber, sourceUrl: url });

    poemPromises.push(
      limit(async () => {
        try {
          logger.debug('Fetching LOC poem page', { source: 'loc-180', sourceUrl: url });
          const response = await fetchImpl(url);
          if (!response.ok) {
            logger.warn('Failed to fetch LOC poem page', {
              source: 'loc-180',
              sourceUrl: url,
              status: response.status,
              statusText: response.statusText,
            });
            return null;
          }

          const html = await response.text();

          let title = extractFirstTagText(html, ['h2']);
          if (!title) {
            title = extractFirstTagText(html, ['h1']);
          }

          let author = extractFirstTagText(html, ['h3']);
          if (!author) {
            author = extractFirstTagText(html, ['h4']);
          }
          author = author.replace(/^by\s+/i, '');

          let contentHtml = extractFirstClassInnerHtml(html, ['poem-body']);
          if (!contentHtml) {
            contentHtml = extractFirstClassInnerHtml(html, ['main-content']);
            contentHtml = removeTags(contentHtml, ['h1', 'h2', 'h3', 'h4']);
          }

          const content = parsePoemContent(contentHtml);

          if (!content) {
            logger.warn('No content found for LOC poem page', {
              source: 'loc-180',
              sourceUrl: url,
              title,
              author,
            });
            return null;
          }

          return {
            sourceId: generateSourceId('loc-180', url, title),
            source: 'loc-180',
            sourceUrl: url,
            title,
            author,
            year: null,
            content,
            themes: [],
            form: null,
            isPublicDomain: false,
            scrapedAt: new Date().toISOString(),
          };
        } catch (error) {
          logger.error('Unhandled LOC poem scrape error', error, {
            source: 'loc-180',
            sourceUrl: url,
          });
          return null;
        }
      }),
    );
  }

  const results = await Promise.all(poemPromises);
  const poems = results.filter((poem): poem is ScrapedPoem => poem !== null);
  logger.info('Completed LOC Poetry 180 scrape', {
    source: 'loc-180',
    poemStart: start,
    poemEnd: end,
    poemCount: poems.length,
    durationMs: Date.now() - startTimeMs,
  });
  return poems;
}
