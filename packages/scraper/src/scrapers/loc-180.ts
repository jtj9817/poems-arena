import { type Browser, type BrowserContext, chromium } from 'playwright';
import { ScrapedPoem } from '../types';
import { generateSourceId } from '../utils/hashing';
import { logger } from '../utils/logger';
import { loadHtml, normalizeWhitespace } from '../utils/html';

// LOC search API — returns all 180 Poetry 180 poems in a single request.
const SEARCH_URL = 'https://www.loc.gov/search/?fa=partof:poetry+180&fo=json&c=200';

const REQUEST_JITTER_MIN_MS = 4000;
const REQUEST_JITTER_MAX_MS = 9000;
const MICRO_BATCH_SIZE = 25;
const MACRO_PAUSE_MIN_MS = 5 * 60 * 1000;
const MACRO_PAUSE_MAX_MS = 10 * 60 * 1000;
const SEARCH_FETCH_MAX_ATTEMPTS = 3;
const POEM_FETCH_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MIN_MS = 1000;
const RETRY_DELAY_MAX_MS = 2500;

// JSON shapes returned by the LOC API
interface SearchResult {
  url: string;
  title?: string;
  shelf_id?: string;
}

interface SearchResponse {
  results?: SearchResult[];
}

interface PoemItem {
  title?: string;
  author?: string[]; // ["LastName, FirstName"] format
  article?: string; // HTML: <pre>poem text</pre><p>—Author</p>
  poem_number?: string;
}

interface PoemResponse {
  item?: PoemItem;
}

interface DelayRange {
  min: number;
  max: number;
}

export interface Loc180ScraperOptions {
  // For unit testing: returns raw response body for a given URL, bypassing Playwright.
  htmlFetcherImpl?: (url: string) => Promise<string>;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
  requestJitterMs?: DelayRange;
  macroPauseEvery?: number;
  macroPauseMs?: DelayRange;
  strictValidation?: boolean;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(min: number, max: number, randomImpl: () => number): number {
  return Math.floor(randomImpl() * (max - min + 1) + min);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function resolveDelayRange(
  override: DelayRange | undefined,
  defaultMin: number,
  defaultMax: number,
): DelayRange {
  if (
    !override ||
    !isFiniteNonNegativeNumber(override.min) ||
    !isFiniteNonNegativeNumber(override.max)
  ) {
    return { min: defaultMin, max: defaultMax };
  }

  if (override.min > override.max) {
    return { min: defaultMin, max: defaultMax };
  }

  return override;
}

function getWafReason(finalUrl: string, contentType: string | null, body: string): string | null {
  const normalizedFinalUrl = finalUrl.toLowerCase();
  if (
    normalizedFinalUrl.includes('captcha') ||
    normalizedFinalUrl.includes('challenge') ||
    normalizedFinalUrl.includes('blocked')
  ) {
    return 'challenge URL';
  }

  if (contentType?.toLowerCase().includes('text/html')) {
    return 'unexpected HTML content type';
  }

  if (body.trimStart().startsWith('<')) {
    return 'unexpected HTML response body';
  }

  return null;
}

/**
 * Converts "LastName, FirstName" (LOC author format) to "FirstName LastName".
 * Falls through unchanged if there is no comma.
 */
function formatAuthorName(raw: string): string {
  const commaIdx = raw.indexOf(',');
  if (commaIdx === -1) return raw.trim();
  const lastName = raw.slice(0, commaIdx).trim();
  const firstName = raw.slice(commaIdx + 1).trim();
  return firstName ? `${firstName} ${lastName}` : lastName;
}

/**
 * Extracts poem content from the `item.article` HTML field returned by the LOC JSON API.
 * The field is structured as: <pre>poem text</pre><p>—Author Name</p>
 */
function parsePoemArticle(articleHtml: string): string | null {
  const $ = loadHtml(articleHtml);
  const preText = $('pre').text();
  if (!preText.trim()) return null;

  return preText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+$/gm, '') // trim trailing whitespace per line
    .replace(/\n{3,}/g, '\n\n') // collapse triple+ newlines to stanza break
    .trim();
}

export async function scrapeLoc180(
  start: number = 1,
  end: number = 180,
  options: Loc180ScraperOptions = {},
): Promise<ScrapedPoem[]> {
  const sleepImpl = options.sleepImpl ?? sleep;
  const randomImpl = options.randomImpl ?? Math.random;
  const requestJitter = resolveDelayRange(
    options.requestJitterMs,
    REQUEST_JITTER_MIN_MS,
    REQUEST_JITTER_MAX_MS,
  );
  const macroPause = resolveDelayRange(
    options.macroPauseMs,
    MACRO_PAUSE_MIN_MS,
    MACRO_PAUSE_MAX_MS,
  );
  const macroPauseEvery = isFiniteNonNegativeNumber(options.macroPauseEvery)
    ? Math.floor(options.macroPauseEvery)
    : MICRO_BATCH_SIZE;
  const strictValidation = options.strictValidation ?? false;
  const startTimeMs = Date.now();

  logger.info('Starting LOC Poetry 180 scrape (JSON API + Playwright)', {
    source: 'loc-180',
    poemStart: start,
    poemEnd: end,
  });

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    if (!options.htmlFetcherImpl) {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ locale: 'en-US' });
    }

    const getBodyViaPageNavigation = async (url: string): Promise<string | null> => {
      const page = await context!.newPage();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const finalUrl = page.url();

        if (!response || !response.ok()) {
          logger.warn('Non-OK response from LOC page navigation', {
            sourceUrl: url,
            status: response?.status(),
          });
          return null;
        }

        const body = await response.text();
        const wafReason = getWafReason(finalUrl, response.headers()['content-type'] ?? null, body);
        if (wafReason) {
          logger.warn('WAF challenge detected via LOC page navigation', {
            sourceUrl: url,
            finalUrl,
            status: response.status(),
            reason: wafReason,
          });
          return null;
        }

        return body;
      } catch (e) {
        logger.warn('Navigation error fetching LOC URL', { url, error: String(e) });
        return null;
      } finally {
        await page.close();
      }
    };

    const getBodyViaPlaywrightRequest = async (url: string): Promise<string | null> => {
      try {
        const response = await context!.request.get(url, { timeout: 30000 });
        if (!response.ok()) {
          logger.warn('Non-OK response from LOC Playwright request', {
            sourceUrl: url,
            status: response.status(),
          });
          return null;
        }

        const body = await response.text();
        const wafReason = getWafReason(
          response.url(),
          response.headers()['content-type'] ?? null,
          body,
        );
        if (wafReason) {
          logger.warn('WAF challenge detected via LOC Playwright request', {
            sourceUrl: url,
            finalUrl: response.url(),
            status: response.status(),
            reason: wafReason,
          });
          return null;
        }

        return body;
      } catch (e) {
        logger.warn('Playwright request error fetching LOC URL', { url, error: String(e) });
        return null;
      }
    };

    const getBodyViaFetch = async (url: string): Promise<string | null> => {
      if (options.htmlFetcherImpl) {
        try {
          return await options.htmlFetcherImpl(url);
        } catch (e) {
          logger.warn('htmlFetcherImpl returned error for URL', { url, error: String(e) });
          return null;
        }
      }

      try {
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn('Non-OK response from LOC fetch', {
            sourceUrl: url,
            status: response.status,
          });
          return null;
        }

        const body = await response.text();
        const wafReason = getWafReason(response.url, response.headers.get('content-type'), body);
        if (wafReason) {
          logger.warn('WAF challenge detected via LOC fetch', {
            sourceUrl: url,
            finalUrl: response.url,
            status: response.status,
            reason: wafReason,
          });
          return null;
        }

        return body;
      } catch (e) {
        logger.warn('Fetch error fetching LOC URL', { url, error: String(e) });
        return null;
      }
    };

    const getBody = async (url: string): Promise<string | null> => {
      const fetchBody = await getBodyViaFetch(url);
      if (fetchBody) return fetchBody;

      if (options.htmlFetcherImpl || !context) return null;

      const playwrightRequestBody = await getBodyViaPlaywrightRequest(url);
      if (playwrightRequestBody) return playwrightRequestBody;

      return await getBodyViaPageNavigation(url);
    };

    const getBodyWithRetries = async (
      url: string,
      maxAttempts: number,
      operation: string,
    ): Promise<string | null> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const body = await getBody(url);
        if (body) return body;

        const shouldRetry = attempt < maxAttempts;
        logger.warn(shouldRetry ? 'LOC fetch failed, retrying' : 'LOC fetch failed after retries', {
          source: 'loc-180',
          operation,
          url,
          attempt,
          maxAttempts,
        });

        if (shouldRetry) {
          const delayMs = randomJitter(RETRY_DELAY_MIN_MS, RETRY_DELAY_MAX_MS, randomImpl);
          await sleepImpl(delayMs);
        }
      }
      return null;
    };

    // ── Step 1: Retrieve all poem URLs via the search API ──────────────────
    const searchBody = await getBodyWithRetries(SEARCH_URL, SEARCH_FETCH_MAX_ATTEMPTS, 'search');
    if (!searchBody) {
      logger.error('Failed to fetch LOC poem list from search API', undefined, {
        source: 'loc-180',
      });
      return [];
    }

    let searchData: SearchResponse;
    try {
      searchData = JSON.parse(searchBody) as SearchResponse;
    } catch (e) {
      logger.error('Failed to parse LOC search API response as JSON', e, { source: 'loc-180' });
      return [];
    }

    if (!searchData.results || searchData.results.length === 0) {
      logger.error('LOC search API returned no results', undefined, { source: 'loc-180' });
      return [];
    }

    // ── Step 2: Filter to the requested number range and sort ──────────────
    const linksByNumber = new Map<number, string>();

    for (const result of searchData.results) {
      if (!result.url) continue;
      const match = result.url.match(/poetry-180-(\d+)/);
      if (!match) continue;

      const number = parseInt(match[1], 10);
      if (number < start || number > end) continue;
      if (linksByNumber.has(number)) continue;

      linksByNumber.set(number, result.url);
    }

    const linksToScrape = [...linksByNumber.entries()]
      .map(([number, url]) => ({ number, url }))
      .sort((a, b) => a.number - b.number);

    const pace = async (processedCount: number): Promise<void> => {
      const isLastPoem = processedCount >= linksToScrape.length;
      if (isLastPoem) return;

      if (macroPauseEvery > 0 && processedCount % macroPauseEvery === 0) {
        const macroPauseMs = randomJitter(macroPause.min, macroPause.max, randomImpl);
        logger.info('Taking macro pause between LOC micro-batches', {
          source: 'loc-180',
          processedCount,
          pauseMs: macroPauseMs,
        });
        await sleepImpl(macroPauseMs);
        return;
      }

      const jitterMs = randomJitter(requestJitter.min, requestJitter.max, randomImpl);
      logger.debug('Applying jitter before next LOC request', {
        source: 'loc-180',
        processedCount,
        delayMs: jitterMs,
      });
      await sleepImpl(jitterMs);
    };

    logger.info('LOC poem list fetched', {
      source: 'loc-180',
      total: searchData.results.length,
      inRange: linksToScrape.length,
    });

    // ── Step 3: Fetch each poem's JSON ─────────────────────────────────────
    const poems: ScrapedPoem[] = [];

    for (let index = 0; index < linksToScrape.length; index++) {
      const { number, url } = linksToScrape[index];
      const poemApiUrl = `${url}?fo=json`;

      logger.debug('Fetching LOC poem JSON', {
        source: 'loc-180',
        poemNumber: number,
        sourceUrl: url,
      });

      const poemBody = await getBodyWithRetries(poemApiUrl, POEM_FETCH_MAX_ATTEMPTS, 'poem');

      if (poemBody) {
        try {
          const poemData = JSON.parse(poemBody) as PoemResponse;
          const item = poemData.item;

          if (!item) {
            logger.warn('LOC poem JSON has no item field', { source: 'loc-180', sourceUrl: url });
          } else {
            const title = item.title ?? '';
            const authorRaw = item.author?.[0] ?? '';
            const author = authorRaw ? formatAuthorName(authorRaw) : '';
            const content = parsePoemArticle(item.article ?? '');

            if (!content) {
              logger.warn('No content extracted from LOC poem article', {
                source: 'loc-180',
                sourceUrl: url,
                poemNumber: number,
              });
            } else {
              poems.push({
                sourceId: generateSourceId('loc-180', url, title),
                source: 'loc-180',
                sourceUrl: url,
                title,
                author: normalizeWhitespace(author),
                year: null,
                content,
                themes: [],
                form: null,
                isPublicDomain: false, // Poetry 180 poems are copyrighted
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        } catch (e) {
          logger.warn('Failed to parse LOC poem JSON', {
            source: 'loc-180',
            sourceUrl: url,
            error: String(e),
          });
        }
      } else {
        logger.warn('Failed to fetch poem JSON, skipping', { source: 'loc-180', sourceUrl: url });
      }

      await pace(index + 1);
    }

    // ── Step 4: Post-scrape validation ────────────────────────────────────
    if (start === 1 && end >= 180 && poems.length < 170) {
      const message = `Post-scrape validation failed: retrieved only ${poems.length} of 180 poems.`;
      if (strictValidation) {
        throw new Error(message);
      }

      logger.error(message, undefined, {
        source: 'loc-180',
        retrieved: poems.length,
        expected: 180,
        poemStart: start,
        poemEnd: end,
      });
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
  } finally {
    await browser?.close();
  }
}
