import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import { extractAnchors, loadHtml, normalizeWhitespace } from '../utils/html';

const LIST_URL =
  'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/';

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
  logger.info('Starting LOC Poetry 180 scrape (discovery mode)', {
    source: 'loc-180',
    poemStart: start,
    poemEnd: end,
  });

  try {
    const listResponse = await fetchImpl(LIST_URL);
    if (!listResponse.ok) {
      logger.error('Failed to fetch LOC list page', undefined, {
        source: 'loc-180',
        status: listResponse.status,
        sourceUrl: LIST_URL,
      });
      return [];
    }

    const listHtml = await listResponse.text();
    const anchors = extractAnchors(listHtml);
    // Find links like .../item/poetry-180-XXX/...
    const poemLinks = anchors.filter((a) => a.href.includes('/item/poetry-180-'));

    const poemPromises: Promise<ScrapedPoem | null>[] = [];
    const seenUrls = new Set<string>();

    for (const link of poemLinks) {
      // Extract number from URL
      const match = link.href.match(/poetry-180-(\d+)/);
      if (!match) {
        continue;
      }
      const number = parseInt(match[1], 10);

      if (number < start || number > end) {
        continue;
      }
      if (seenUrls.has(link.href)) {
        continue;
      }
      seenUrls.add(link.href);

      // Ensure absolute URL
      const url = link.href.startsWith('http') ? link.href : `https://www.loc.gov${link.href}`;

      poemPromises.push(
        limit(async () => {
          try {
            logger.debug('Fetching LOC poem page', {
              source: 'loc-180',
              poemNumber: number,
              sourceUrl: url,
            });
            const response = await fetchImpl(url);
            if (!response.ok) {
              logger.warn('Failed to fetch LOC poem page', {
                source: 'loc-180',
                sourceUrl: url,
                status: response.status,
              });
              return null;
            }
            const html = await response.text();
            const $ = loadHtml(html);

            const title =
              $('meta[name="dc.title"]').attr('content') ||
              $('title').text().replace(' | Library of Congress', '').trim();

            // Author extraction strategy:
            // 1. Check meta tags
            // 2. Check <p> after <pre>
            // 3. Fallback to extracting from text
            let author = $('meta[name="dc.creator"]').attr('content') || '';
            if (!author) {
              // Try to find author in <p> tag inside .poem or .poem-content
              // Sample showed <div class="poem"> <pre>...</pre> <p>--Billy Collins</p> </div>
              const potentialAuthor = $('.poem p').text().trim();
              if (
                potentialAuthor.includes('Billy Collins') ||
                potentialAuthor.startsWith('—') ||
                potentialAuthor.startsWith('--')
              ) {
                author = potentialAuthor.replace(/^[—\-\s]+/, '');
              }
            }
            if (!author) {
              // Fallback to specific check if "Billy Collins" is found on page, common for this collection
              if (html.includes('Billy Collins')) {
                author = 'Billy Collins';
              }
            }

            // Content extraction
            // Target <div class="poem"> <pre>
            let contentHtml = $('.poem pre').html();

            // Fallback for older structure
            if (!contentHtml) {
              contentHtml = $('.poem-body').html() || $('.main-content').html();
              // Clean up if fallback used
              if (contentHtml) {
                const $content = loadHtml(contentHtml); // Load fragment
                $content('h1, h2, h3, h4').remove();
                contentHtml = $content.html();
              }
            }

            if (!contentHtml) {
              logger.warn('No content found for LOC poem page', {
                source: 'loc-180',
                sourceUrl: url,
              });
              return null;
            }

            const content = parsePoemContent(contentHtml);

            if (!content) {
              return null;
            }

            return {
              sourceId: generateSourceId('loc-180', url, title),
              source: 'loc-180',
              sourceUrl: url,
              title,
              author: normalizeWhitespace(author),
              year: null,
              content,
              themes: [],
              form: null,
              isPublicDomain: false, // Most are copyrighted
              scrapedAt: new Date().toISOString(),
            };
          } catch (e) {
            logger.error('Error scraping poem', e, { source: 'loc-180', sourceUrl: url });
            return null;
          }
        }),
      );
    }

    const results = await Promise.all(poemPromises);
    const poems = results.filter((p): p is ScrapedPoem => p !== null);

    logger.info('Completed LOC Poetry 180 scrape', {
      source: 'loc-180',
      count: poems.length,
      durationMs: Date.now() - startTimeMs,
    });

    return poems;
  } catch (e) {
    logger.error('Critical error in LOC scrape', e, { source: 'loc-180' });
    return [];
  }
}
