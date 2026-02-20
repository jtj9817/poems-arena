import { expect, test, describe, mock } from 'bun:test';
import { scrapePoetsOrg, getPoemUrls } from './poets-org';

const mockListPage = `
<!DOCTYPE html>
<html>
<body>
  <div class="view-content">
    <table>
      <tbody>
        <tr>
          <td><a href="/poem/test-poem-1">Test Poem 1</a></td>
          <td><a href="/poet/test-poet-1">Test Poet 1</a></td>
          <td>2023</td>
        </tr>
      </tbody>
    </table>
  </div>
  <ul class="pagination">
    <li class="pager__item--next"><a href="?page=1">Next</a></li>
  </ul>
</body>
</html>
`;

const mockPoemPage = `
<!DOCTYPE html>
<html>
<body>
  <h1 class="page-title">Test Poem 1</h1>
  <div class="field--name-field-poem-body">
    <p>Line 1</p>
    <p>Line 2</p>
  </div>
  <div class="field--name-title">Test Poet 1</div>
  <div class="field--name-field-poem-themes">
    <a href="/themes/nature">Nature</a>
  </div>
  <div class="field--name-field-occasion">
    <a href="/occasions/graduation">Graduation</a>
  </div>
</body>
</html>
`;

describe('scrapePoetsOrg', () => {
  test('should extract poem URLs from list page', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(mockListPage)));

    const urls = await getPoemUrls(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://poets.org/poem/test-poem-1');
  });

  test('should scrape poem details', async () => {
    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(mockPoemPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Test Poem 1');
    expect(poems[0].author).toBe('Test Poet 1');
    expect(poems[0].content).toContain('Line 1');
    expect(poems[0].themes).toContain('Nature');
  });

  test('should detect public domain correctly', async () => {
    const publicDomainPoemPage = `
      <!DOCTYPE html>
      <html>
      <body>
        <h1 class="page-title">Public Domain Poem</h1>
        <div class="field--name-field-poem-body"><p>Content</p></div>
        <footer>
          <p>This work is in the Public Domain.</p>
        </footer>
      </body>
      </html>
    `;

    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(publicDomainPoemPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems[0].isPublicDomain).toBe(true);
  });

  test('should not mark as public domain if not explicitly stated', async () => {
    const copyrightedPoemPage = `
      <!DOCTYPE html>
      <html>
      <body>
        <h1 class="page-title">Copyrighted Poem</h1>
        <div class="field--name-field-poem-body"><p>Content</p></div>
        <footer>
          <p>Copyright 2023. All rights reserved.</p>
        </footer>
      </body>
      </html>
    `;

    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(copyrightedPoemPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems[0].isPublicDomain).toBe(false);
  });

  // --- Regression tests (3B) ---

  test('pagination: getPoemUrls(3) fetches pages 0, 1, 2', async () => {
    const fetchedPages: number[] = [];
    global.fetch = mock((url) => {
      const urlStr = url.toString();
      const pageMatch = urlStr.match(/page=(\d+)/);
      if (pageMatch) {
        fetchedPages.push(Number(pageMatch[1]));
      }
      return Promise.resolve(new Response(mockListPage));
    });

    await getPoemUrls(3);

    expect(fetchedPages).toEqual([0, 1, 2]);
  });

  test('duplicate URL deduplication across pages', async () => {
    // Both pages return the same poem URL
    global.fetch = mock(() => Promise.resolve(new Response(mockListPage)));

    const urls = await getPoemUrls(2);

    // Even though 2 pages returned the same link, result should be deduplicated
    expect(urls).toHaveLength(1);
  });

  test('public domain detection via theme', async () => {
    const themePublicDomainPage = `
      <!DOCTYPE html>
      <html>
      <body>
        <h1 class="page-title">Theme PD Poem</h1>
        <div class="field--name-field-poem-body"><p>Content</p></div>
        <a href="/themes/public-domain">Public Domain</a>
      </body>
      </html>
    `;

    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(themePublicDomainPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems[0].isPublicDomain).toBe(true);
  });

  test('theme extraction from /themes/ anchors', async () => {
    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(mockPoemPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems[0].themes).toContain('Nature');
  });

  test('form extraction from /forms/ anchors', async () => {
    const poemWithForm = `
      <!DOCTYPE html>
      <html>
      <body>
        <h1 class="page-title">Sonnet</h1>
        <div class="field--name-field-poem-body"><p>Content</p></div>
        <a href="/forms/sonnet">Sonnet</a>
      </body>
      </html>
    `;

    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(poemWithForm));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems[0].form).toBe('Sonnet');
  });

  test('content body fallback chain (multiple class selectors)', async () => {
    // Uses field--body instead of field--name-field-poem-body
    const fallbackContentPage = `
      <!DOCTYPE html>
      <html>
      <body>
        <h1 class="page-title">Fallback Poem</h1>
        <div class="field--body"><p>Fallback content</p></div>
      </body>
      </html>
    `;

    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(fallbackContentPage));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems).toHaveLength(1);
    expect(poems[0].content).toContain('Fallback content');
  });

  test('graceful 404 on detail page', async () => {
    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const poems = await scrapePoetsOrg(1);
    expect(poems).toHaveLength(0);
  });

  test('all poems have source poets.org', async () => {
    global.fetch = mock((url) => {
      if (url.toString().includes('poems')) {
        return Promise.resolve(new Response(mockListPage));
      }
      return Promise.resolve(new Response(mockPoemPage));
    });

    const poems = await scrapePoetsOrg(1);
    for (const poem of poems) {
      expect(poem.source).toBe('poets.org');
    }
  });
});
