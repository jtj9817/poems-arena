import { expect, test, describe } from 'bun:test';
import { scrapeLoc180 } from './loc-180';

const noSleep = async (_ms: number) => {};

// ── JSON fixture factories ─────────────────────────────────────────────────

function makeSearchJson(poems: Array<{ num: number; slug: string; title: string }>): string {
  return JSON.stringify({
    results: poems.map(({ num, slug, title }) => ({
      url: `https://www.loc.gov/item/poetry-180-${String(num).padStart(3, '0')}/${slug}/`,
      title,
      shelf_id: `poetry-and-literature|poetry-180|${String(num).padStart(3, '0')}|${slug}|1`,
    })),
  });
}

function makePoemJson(opts: {
  title?: string;
  author?: string; // "LastName, FirstName" LOC format
  articleHtml?: string;
  poemNumber?: string;
}): string {
  const title = opts.title ?? 'Introduction to Poetry';
  const author = opts.author ?? 'Collins, Billy';
  const poemNumber = opts.poemNumber ?? '001';
  const articleHtml =
    opts.articleHtml ??
    `<pre>I ask them to take a poem\r\nand hold it up to the light\r\nlike a color slide\r\n\r\nor press an ear against its hive.</pre><p>\u2014Billy Collins</p>`;

  return JSON.stringify({
    item: { title, author: [author], article: articleHtml, poem_number: poemNumber },
  });
}

/**
 * Creates an htmlFetcherImpl stub.
 * Matches by substring — first matching key wins.
 * Throw Error('404') to simulate a missing resource.
 */
function createFetcher(map: Record<string, string | Error>): (url: string) => Promise<string> {
  return async (url: string) => {
    for (const [pattern, value] of Object.entries(map)) {
      if (url.includes(pattern)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`No stub for URL: ${url}`);
  };
}

// Common fixtures
const poem1 = { num: 1, slug: 'introduction-to-poetry', title: 'Introduction to Poetry' };
const poem2 = { num: 2, slug: 'the-good-life', title: 'The Good Life' };
const searchJson12 = makeSearchJson([poem1, poem2]);
const defaultPoemJson = makePoemJson({});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('scrapeLoc180', () => {
  test('extracts poem title, author, content, source, and sourceUrl correctly', async () => {
    const fetcher = createFetcher({
      'partof:poetry+180': makeSearchJson([poem1]),
      'poetry-180-001': makePoemJson({
        title: 'Introduction to Poetry',
        author: 'Collins, Billy',
        articleHtml: '<pre>I ask them to take a poem\r\nand hold it up to the light.</pre>',
      }),
    });

    const poems = await scrapeLoc180(1, 1, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Introduction to Poetry');
    expect(poems[0].author).toBe('Billy Collins');
    expect(poems[0].source).toBe('loc-180');
    expect(poems[0].content).toContain('I ask them to take a poem');
    expect(poems[0].sourceUrl).toContain('poetry-180-001');
  });

  test('author formatted from "LastName, FirstName" to "FirstName LastName"', async () => {
    const fetcher = createFetcher({
      'partof:poetry+180': makeSearchJson([poem2]),
      'poetry-180-002': makePoemJson({ author: 'Smith, Tracy K.' }),
    });

    const poems = await scrapeLoc180(2, 2, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poems).toHaveLength(1);
    expect(poems[0].author).toBe('Tracy K. Smith');
  });

  test('range handling: scrapeLoc180(5, 7) fetches only poems in range', async () => {
    const rangePoems = [
      { num: 5, slug: 'poem-five', title: 'Poem Five' },
      { num: 6, slug: 'poem-six', title: 'Poem Six' },
      { num: 7, slug: 'poem-seven', title: 'Poem Seven' },
      { num: 8, slug: 'poem-eight', title: 'Poem Eight' },
    ];
    const fetchedUrls: string[] = [];

    const fetcher = async (url: string): Promise<string> => {
      fetchedUrls.push(url);
      if (url.includes('partof:poetry+180')) return makeSearchJson(rangePoems);
      return defaultPoemJson;
    };

    const poems = await scrapeLoc180(5, 7, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    const poemFetches = fetchedUrls.filter((u) => u.includes('poetry-180-'));
    expect(poemFetches).toHaveLength(3);
    expect(poems).toHaveLength(3);
    expect(poemFetches.some((u) => u.includes('poetry-180-008'))).toBe(false);
  });

  test('graceful failure: missing poem is filtered out, others still returned', async () => {
    let poem2CallCount = 0;

    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return searchJson12;
      if (url.includes('poetry-180-001')) return defaultPoemJson;
      if (url.includes('poetry-180-002')) {
        poem2CallCount++;
        throw new Error('simulated 404');
      }
      throw new Error(`No stub for ${url}`);
    };

    const poems = await scrapeLoc180(1, 2, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poem2CallCount).toBe(3);
    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Introduction to Poetry');
  });

  test('retries search API fetch and recovers from transient failures', async () => {
    let searchCallCount = 0;

    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) {
        searchCallCount++;
        if (searchCallCount < 3) {
          throw new Error('temporary network error');
        }
        return makeSearchJson([poem1]);
      }

      if (url.includes('poetry-180-001')) {
        return defaultPoemJson;
      }

      throw new Error(`No stub for ${url}`);
    };

    const poems = await scrapeLoc180(1, 1, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(searchCallCount).toBe(3);
    expect(poems).toHaveLength(1);
  });

  test('retries poem JSON fetch and recovers from transient failures', async () => {
    let poemCallCount = 0;

    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return makeSearchJson([poem1]);

      if (url.includes('poetry-180-001')) {
        poemCallCount++;
        if (poemCallCount < 3) {
          throw new Error('temporary timeout');
        }
        return defaultPoemJson;
      }

      throw new Error(`No stub for ${url}`);
    };

    const poems = await scrapeLoc180(1, 1, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poemCallCount).toBe(3);
    expect(poems).toHaveLength(1);
  });

  test('all poems have source "loc-180" and isPublicDomain false', async () => {
    const fetcher = createFetcher({
      'partof:poetry+180': searchJson12,
      'poetry-180-': defaultPoemJson,
    });

    const poems = await scrapeLoc180(1, 2, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    for (const poem of poems) {
      expect(poem.source).toBe('loc-180');
      expect(poem.isPublicDomain).toBe(false);
    }
  });

  test('sourceUrl contains the poem-specific URL (not the search URL)', async () => {
    const fetcher = createFetcher({
      'partof:poetry+180': searchJson12,
      'poetry-180-': defaultPoemJson,
    });

    const poems = await scrapeLoc180(1, 2, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    for (const poem of poems) {
      expect(poem.sourceUrl).toContain('poetry-180-');
      expect(poem.sourceUrl).not.toContain('search');
    }
  });

  test('poem content is extracted from <pre> block in item.article', async () => {
    const articleHtml =
      '<pre>Body my house\r\nmy horse my hound\r\n\r\nwhat will I do</pre><p>\u2014May Swenson</p>';

    const fetcher = createFetcher({
      'partof:poetry+180': makeSearchJson([{ num: 4, slug: 'question', title: 'Question' }]),
      'poetry-180-004': makePoemJson({ articleHtml }),
    });

    const poems = await scrapeLoc180(4, 4, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poems).toHaveLength(1);
    expect(poems[0].content).toContain('Body my house');
    expect(poems[0].content).toContain('what will I do');
    // attribution line should NOT appear in content
    expect(poems[0].content).not.toContain('May Swenson');
  });

  test('applies jitter between every request with no macro-pauses', async () => {
    const delays: number[] = [];

    // 26 poems: poems 1–26
    const twentySixPoems = Array.from({ length: 26 }, (_, i) => ({
      num: i + 1,
      slug: `poem-${String(i + 1).padStart(3, '0')}`,
      title: `Poem ${i + 1}`,
    }));

    const fetcher = createFetcher({
      'partof:poetry+180': makeSearchJson(twentySixPoems),
      'poetry-180-': defaultPoemJson,
    });

    const poems = await scrapeLoc180(1, 26, {
      htmlFetcherImpl: fetcher,
      sleepImpl: async (ms: number) => {
        delays.push(ms);
      },
      randomImpl: () => 0,
      requestJitterMs: { min: 10, max: 20 },
    });

    expect(poems).toHaveLength(26);
    // jitter applied after every poem except the last (25 delays total)
    expect(delays).toHaveLength(25);
    expect(delays.every((ms) => ms === 10)).toBe(true);
  });

  test('dedupes by poem number and keeps deterministic first URL', async () => {
    const duplicateNumberSearch = JSON.stringify({
      results: [
        { url: 'https://www.loc.gov/item/poetry-180-001/first-slug/' },
        { url: 'https://www.loc.gov/item/poetry-180-001/second-slug/' },
      ],
    });
    const fetchedPoemUrls: string[] = [];
    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return duplicateNumberSearch;
      fetchedPoemUrls.push(url);
      return makePoemJson({ title: 'Poem One' });
    };

    const poems = await scrapeLoc180(1, 1, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poems).toHaveLength(1);
    expect(fetchedPoemUrls).toHaveLength(1);
    expect(fetchedPoemUrls[0]).toContain('first-slug');
    expect(poems[0].sourceUrl).toContain('first-slug');
  });

  test('supports configurable requestJitterMs and applies jitter between poems', async () => {
    const delays: number[] = [];
    const threePoems = Array.from({ length: 3 }, (_, i) => ({
      num: i + 1,
      slug: `poem-${String(i + 1).padStart(3, '0')}`,
      title: `Poem ${i + 1}`,
    }));
    const fetcher = createFetcher({
      'partof:poetry+180': makeSearchJson(threePoems),
      'poetry-180-': defaultPoemJson,
    });

    const poems = await scrapeLoc180(1, 3, {
      htmlFetcherImpl: fetcher,
      sleepImpl: async (ms: number) => {
        delays.push(ms);
      },
      randomImpl: () => 0,
      requestJitterMs: { min: 10, max: 20 },
    });

    expect(poems).toHaveLength(3);
    // jitter applied after poem 1 and poem 2; skipped after poem 3 (last)
    expect(delays).toEqual([10, 10]);
  });

  test('returns partial results when post-scrape validation fails by default', async () => {
    const allPoems = Array.from({ length: 180 }, (_, i) => ({
      num: i + 1,
      slug: `poem-${String(i + 1).padStart(3, '0')}`,
      title: `Poem ${i + 1}`,
    }));
    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return makeSearchJson(allPoems);
      const match = url.match(/poetry-180-(\d{3})/);
      if (!match) throw new Error(`No stub for ${url}`);
      const poemNumber = parseInt(match[1], 10);
      if (poemNumber <= 160) {
        return makePoemJson({ title: `Poem ${poemNumber}` });
      }
      throw new Error('simulated fetch failure');
    };

    const poems = await scrapeLoc180(1, 180, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });

    expect(poems).toHaveLength(160);
  });

  test('preserves strict post-scrape validation mode when enabled', async () => {
    const allPoems = Array.from({ length: 180 }, (_, i) => ({
      num: i + 1,
      slug: `poem-${String(i + 1).padStart(3, '0')}`,
      title: `Poem ${i + 1}`,
    }));
    const fetcher = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return makeSearchJson(allPoems);
      const match = url.match(/poetry-180-(\d{3})/);
      if (!match) throw new Error(`No stub for ${url}`);
      const poemNumber = parseInt(match[1], 10);
      if (poemNumber <= 160) {
        return makePoemJson({ title: `Poem ${poemNumber}` });
      }
      throw new Error('simulated fetch failure');
    };

    const poems = await scrapeLoc180(1, 180, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
      randomImpl: () => 0,
      strictValidation: true,
    });

    expect(poems).toHaveLength(0);
  });

  test('returns empty array if search API fails', async () => {
    const fetcher = async (_url: string): Promise<string> => {
      throw new Error('network error');
    };

    const poems = await scrapeLoc180(1, 180, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
    });

    expect(poems).toHaveLength(0);
  });

  test('returns empty array if search response has no results field', async () => {
    const fetcher = createFetcher({
      'partof:poetry+180': JSON.stringify({ error: 'something went wrong' }),
    });

    const poems = await scrapeLoc180(1, 180, {
      htmlFetcherImpl: fetcher,
      sleepImpl: noSleep,
    });

    expect(poems).toHaveLength(0);
  });
});
