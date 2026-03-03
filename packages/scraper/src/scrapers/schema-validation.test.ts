import { describe, expect, mock, test } from 'bun:test';
import { ScrapedPoem } from '../types';
import { scrapeGutenbergEmerson } from './gutenberg';
import { scrapeLoc180 } from './loc-180';
import { scrapePoetsOrg } from './poets-org';

const gutenbergHtml = `
<html><body>
  <h2>TEST POEM</h2>
  <p>Some poem content for testing.</p>
</body></html>`;

const locSearchJson = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/item/poetry-180-001/test-poem/',
      title: 'Test LOC Poem',
      shelf_id: 'poetry-and-literature|poetry-180|001|test-poem|1',
    },
  ],
});

const locPoemJson = JSON.stringify({
  item: {
    title: 'Test LOC Poem',
    author: ['Author, Test'],
    article: '<pre>Test LOC content here.</pre><p>\u2014Test Author</p>',
    poem_number: '001',
  },
});

const poetsListHtml = `
<html><body>
  <a href="/poem/test-poem-1">Test Poem</a>
</body></html>`;

const poetsDetailHtml = `
<!DOCTYPE html>
<html>
<body>
  <h1 class="page-title">Test Poets Poem</h1>
  <div class="field--name-field-poem-body"><p>Poets.org content</p></div>
  <a href="/poet/test-poet">Test Poet</a>
</body>
</html>`;

function assertScrapedPoemShape(poem: ScrapedPoem): void {
  expect(typeof poem.sourceId).toBe('string');
  expect(poem.sourceId.length).toBeGreaterThan(0);

  expect(typeof poem.source).toBe('string');
  expect(['poets.org', 'poetry-foundation', 'loc-180', 'gutenberg']).toContain(poem.source);

  expect(typeof poem.sourceUrl).toBe('string');
  expect(poem.sourceUrl.length).toBeGreaterThan(0);

  expect(typeof poem.title).toBe('string');
  expect(poem.title.length).toBeGreaterThan(0);

  expect(typeof poem.author).toBe('string');

  expect(poem.year === null || typeof poem.year === 'string').toBe(true);

  expect(typeof poem.content).toBe('string');
  expect(poem.content.length).toBeGreaterThan(0);

  expect(Array.isArray(poem.themes)).toBe(true);

  expect(poem.form === null || typeof poem.form === 'string').toBe(true);

  expect(typeof poem.isPublicDomain).toBe('boolean');

  expect(typeof poem.scrapedAt).toBe('string');
  // Validate ISO 8601
  const parsed = new Date(poem.scrapedAt);
  expect(parsed.toISOString()).toBe(poem.scrapedAt);
}

describe('ScrapedPoem schema validation', () => {
  test('Gutenberg scraper returns valid ScrapedPoem objects', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(gutenbergHtml)));

    const poems = await scrapeGutenbergEmerson('https://example.com/gutenberg', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(poems.length).toBeGreaterThan(0);
    for (const poem of poems) {
      assertScrapedPoemShape(poem);
    }
  });

  test('LOC-180 scraper returns valid ScrapedPoem objects', async () => {
    const htmlFetcherImpl = async (url: string): Promise<string> => {
      if (url.includes('partof:poetry+180')) return locSearchJson;
      if (url.includes('poetry-180-001')) return locPoemJson;
      throw new Error(`No stub for URL: ${url}`);
    };

    const poems = await scrapeLoc180(1, 1, {
      htmlFetcherImpl,
      sleepImpl: async () => {},
    });

    expect(poems.length).toBeGreaterThan(0);
    for (const poem of poems) {
      assertScrapedPoemShape(poem);
    }
  });

  test('Poets.org scraper returns valid ScrapedPoem objects', async () => {
    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(poetsListHtml));
      }
      return Promise.resolve(new Response(poetsDetailHtml));
    });

    const poems = await scrapePoetsOrg(1);

    expect(poems.length).toBeGreaterThan(0);
    for (const poem of poems) {
      assertScrapedPoemShape(poem);
    }
  });
});
