import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import {
  extractAnchorsByHrefPrefix,
  extractFirstClassInnerHtml,
  extractFirstTagText,
  extractFirstTagTextByClass,
  hasCaseInsensitiveText,
} from '../utils/html';

const BASE_URL = 'https://poets.org';
const POEMS_LIST_URL = 'https://poets.org/poems';

const limit = createRateLimiter({ concurrency: 5, minDelay: 200 });

export interface PoetsOrgScraperOptions {
  fetchImpl?: typeof fetch;
}

function detectPublicDomain(pageHtml: string, themes: string[]): boolean {
  const themeContainsPublicDomain = themes.some((theme) =>
    theme.toLowerCase().includes('public domain'),
  );
  if (themeContainsPublicDomain) {
    return true;
  }

  const copyrightFieldHtml = extractFirstClassInnerHtml(pageHtml, [
    'field--name-field-copyright',
    'field--name-field-credits',
  ]);

  return (
    hasCaseInsensitiveText(copyrightFieldHtml, 'public domain') ||
    hasCaseInsensitiveText(pageHtml, 'public domain')
  );
}

export async function getPoemUrls(
  maxPages: number = 1,
  options: PoetsOrgScraperOptions = {},
): Promise<string[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const urls: string[] = [];
  logger.info('Starting Poets.org list scrape', { source: 'poets.org', maxPages });

  for (let page = 0; page < maxPages; page++) {
    const url = `${POEMS_LIST_URL}?page=${page}`;
    try {
      logger.debug('Fetching Poets.org list page', { source: 'poets.org', page, sourceUrl: url });
      const response = await fetchImpl(url);
      if (!response.ok) {
        logger.warn('Failed to fetch Poets.org list page', {
          source: 'poets.org',
          page,
          sourceUrl: url,
          status: response.status,
          statusText: response.statusText,
        });
        continue;
      }

      const html = await response.text();
      const pagePoemUrls = extractAnchorsByHrefPrefix(html, '/poem/').map(
        (anchor) => `${BASE_URL}${anchor.href}`,
      );
      urls.push(...pagePoemUrls);
    } catch (error) {
      logger.error('Unhandled Poets.org list page scrape error', error, {
        source: 'poets.org',
        page,
        sourceUrl: url,
      });
    }
  }

  const uniqueUrls = [...new Set(urls)];
  logger.info('Completed Poets.org list scrape', {
    source: 'poets.org',
    maxPages,
    poemUrlCount: uniqueUrls.length,
  });
  return uniqueUrls;
}

export async function scrapePoetsOrg(
  maxPages: number = 1,
  options: PoetsOrgScraperOptions = {},
): Promise<ScrapedPoem[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const startTimeMs = Date.now();
  const urls = await getPoemUrls(maxPages, { fetchImpl });
  const poemPromises: Promise<ScrapedPoem | null>[] = [];
  logger.info('Starting Poets.org detail scrape', {
    source: 'poets.org',
    poemUrlCount: urls.length,
    maxPages,
  });

  for (const url of urls) {
    poemPromises.push(
      limit(async () => {
        try {
          logger.debug('Fetching Poets.org detail page', { source: 'poets.org', sourceUrl: url });
          const response = await fetchImpl(url);
          if (!response.ok) {
            logger.warn('Failed to fetch Poets.org detail page', {
              source: 'poets.org',
              sourceUrl: url,
              status: response.status,
              statusText: response.statusText,
            });
            return null;
          }

          const html = await response.text();

          let title = extractFirstTagTextByClass(html, 'h1', 'page-title');
          if (!title) {
            title = extractFirstTagText(html, ['h1']);
          }

          let author = extractAnchorsByHrefPrefix(html, '/poet/')[0]?.text || '';
          if (!author) {
            author = extractFirstTagTextByClass(html, 'div', 'field--name-title');
          }

          let contentHtml = extractFirstClassInnerHtml(html, ['field--name-body']);
          if (!contentHtml) {
            contentHtml = extractFirstClassInnerHtml(html, ['field--name-field-poem-body']);
          }
          if (!contentHtml) {
            contentHtml = extractFirstClassInnerHtml(html, ['poem-body']);
          }
          if (!contentHtml) {
            contentHtml = extractFirstClassInnerHtml(html, ['field--name-field-poem']);
          }

          const content = parsePoemContent(contentHtml);
          if (!content) {
            logger.warn('No poem content found on Poets.org detail page', {
              source: 'poets.org',
              sourceUrl: url,
              title,
            });
            return null;
          }

          const themes = extractAnchorsByHrefPrefix(html, '/themes/').map((anchor) => anchor.text);
          const form = extractAnchorsByHrefPrefix(html, '/forms/')[0]?.text || null;
          const isPublicDomain = detectPublicDomain(html, themes);

          return {
            sourceId: generateSourceId('poets.org', url, title),
            source: 'poets.org',
            sourceUrl: url,
            title,
            author,
            year: null,
            content,
            themes: [...new Set(themes)],
            form,
            isPublicDomain,
            scrapedAt: new Date().toISOString(),
          };
        } catch (error) {
          logger.error('Unhandled Poets.org detail scrape error', error, {
            source: 'poets.org',
            sourceUrl: url,
          });
          return null;
        }
      }),
    );
  }

  const results = await Promise.all(poemPromises);
  const poems = results.filter((poem): poem is ScrapedPoem => poem !== null);
  logger.info('Completed Poets.org detail scrape', {
    source: 'poets.org',
    poemCount: poems.length,
    durationMs: Date.now() - startTimeMs,
  });
  return poems;
}
