import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import { extractAnchors, loadHtml, normalizeWhitespace } from '../utils/html';

const LIST_URL =
  'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/';

const limit = createRateLimiter({ concurrency: 1, minDelay: 4000 });

let globalPauseUntil = 0;

export interface Loc180ScraperOptions {
  fetchImpl?: typeof fetch;
}

function parseRetryAfterDelayMs(retryAfter: string | null, nowMs: number = Date.now()): number {
  if (!retryAfter) {
    return 0;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }

  const retryAfterDateMs = Date.parse(retryAfter);
  if (Number.isNaN(retryAfterDateMs)) {
    return 0;
  }

  return Math.max(0, retryAfterDateMs - nowMs);
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
    // Fetch list page with retry on 429/5xx — same circuit breaker shared with poem fetches.
    let listHtml: string | null = null;
    const listMaxRetries = 4;
    const listBaseDelay = 15000;
    for (let listAttempt = 0; listAttempt <= listMaxRetries; listAttempt++) {
      while (Date.now() < globalPauseUntil) {
        const waitTime = globalPauseUntil - Date.now();
        logger.info('Circuit breaker active before list fetch, waiting', {
          source: 'loc-180',
          waitMs: waitTime,
        });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      const listResponse = await fetchImpl(LIST_URL);
      if (listResponse.ok) {
        listHtml = await listResponse.text();
        break;
      }
      if ([403, 404, 410].includes(listResponse.status)) {
        logger.error('Terminal error fetching LOC list page', undefined, {
          source: 'loc-180',
          status: listResponse.status,
          sourceUrl: LIST_URL,
        });
        return [];
      }
      if (listAttempt === listMaxRetries) {
        logger.error('Failed to fetch LOC list page after all retries', undefined, {
          source: 'loc-180',
          status: listResponse.status,
          sourceUrl: LIST_URL,
        });
        return [];
      }
      const retryAfter = listResponse.headers.get('Retry-After');
      let delayMs = parseRetryAfterDelayMs(retryAfter);
      if (delayMs === 0) {
        const jitter = 0.8 + Math.random() * 0.4;
        delayMs = listBaseDelay * Math.pow(2, listAttempt) * jitter;
      }
      const circuitBreakerDelay = Math.max(delayMs, 90_000);
      logger.warn('Rate limited fetching LOC list page, backing off', {
        source: 'loc-180',
        status: listResponse.status,
        delayMs: circuitBreakerDelay,
        attempt: listAttempt + 1,
      });
      globalPauseUntil = Math.max(globalPauseUntil, Date.now() + circuitBreakerDelay);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!listHtml) return [];
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
          let attempt = 0;
          const maxRetries = 4;
          const baseDelay = 15000;

          while (attempt <= maxRetries) {
            while (Date.now() < globalPauseUntil) {
              const waitTime = globalPauseUntil - Date.now();
              logger.debug('Circuit breaker active, waiting', {
                source: 'loc-180',
                waitMs: waitTime,
              });
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }

            let html: string | undefined;

            try {
              logger.debug('Fetching LOC poem page', {
                source: 'loc-180',
                poemNumber: number,
                sourceUrl: url,
                attempt: attempt + 1,
              });
              const response = await fetchImpl(url);

              if (!response.ok) {
                if ([403, 404, 410].includes(response.status)) {
                  logger.warn('Terminal error fetching LOC poem page', {
                    source: 'loc-180',
                    sourceUrl: url,
                    status: response.status,
                  });
                  return null;
                }

                if (response.status === 429 || response.status >= 500) {
                  if (attempt === maxRetries) {
                    logger.error('Max retries reached for LOC poem page', undefined, {
                      source: 'loc-180',
                      sourceUrl: url,
                      status: response.status,
                    });
                    return null;
                  }

                  const retryAfter = response.headers.get('Retry-After');
                  let delayMs = parseRetryAfterDelayMs(retryAfter);

                  if (delayMs === 0) {
                    const jitter = 0.8 + Math.random() * 0.4;
                    delayMs = baseDelay * Math.pow(2, attempt) * jitter;
                  }

                  // Enforce a minimum global pause of 90s on first 429 to let the WAF block expire.
                  const minCircuitBreakerMs = 90_000;
                  const circuitBreakerDelay = Math.max(delayMs, minCircuitBreakerMs);

                  logger.warn('Rate limited or server error, backing off', {
                    source: 'loc-180',
                    sourceUrl: url,
                    status: response.status,
                    delayMs: circuitBreakerDelay,
                    attempt: attempt + 1,
                  });

                  globalPauseUntil = Math.max(globalPauseUntil, Date.now() + circuitBreakerDelay);

                  await new Promise((resolve) => setTimeout(resolve, delayMs));
                  attempt++;
                  continue;
                }

                logger.warn('Failed to fetch LOC poem page', {
                  source: 'loc-180',
                  sourceUrl: url,
                  status: response.status,
                });
                return null;
              }

              html = await response.text();
            } catch (e) {
              if (attempt === maxRetries) {
                logger.error('Error scraping poem', e, { source: 'loc-180', sourceUrl: url });
                return null;
              }
              const jitter = 0.8 + Math.random() * 0.4;
              const delayMs = baseDelay * Math.pow(2, attempt) * jitter;

              logger.warn('Network error, backing off', {
                source: 'loc-180',
                sourceUrl: url,
                delayMs,
                attempt: attempt + 1,
                error: String(e),
              });

              await new Promise((resolve) => setTimeout(resolve, delayMs));
              attempt++;
              continue;
            }

            if (html === undefined) {
              return null;
            }

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
          }
          return null;
        }),
      );
    }

    const results = await Promise.all(poemPromises);
    const poems = results.filter((p): p is ScrapedPoem => p !== null);

    if (start === 1 && end >= 180 && poems.length < 170) {
      throw new Error(
        `Post-scrape validation failed: retrieved only ${poems.length} of 180 poems.`,
      );
    }

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
