import { expect, test, describe, mock } from 'bun:test';
import { scrapeLoc180 } from './loc-180';

const listHtml = `
<html>
<body>
<a href="/item/poetry-180-001/introduction-to-poetry/">Poem 001</a>
<a href="/item/poetry-180-002/another-poem/">Poem 002</a>
</body>
</html>
`;

const listHtmlRange = `
<html>
<body>
<a href="/item/poetry-180-005/poem-five/">Poem 005</a>
<a href="/item/poetry-180-006/poem-six/">Poem 006</a>
<a href="/item/poetry-180-007/poem-seven/">Poem 007</a>
<a href="/item/poetry-180-008/poem-eight/">Poem 008</a>
</body>
</html>
`;

const detailHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta name="dc.title" content="Introduction to Poetry" />
    <meta name="dc.creator" content="Billy Collins" />
</head>
<body>
<div class="poem">
    <pre>I ask them to take a poem
and hold it up to the light
like a color slide

or press an ear against its hive.</pre>
    <p>—Billy Collins</p>
</div>
</body>
</html>
`;

function createMockFetch(list: string, detail: string) {
  return mock((url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('all-poems')) {
      return Promise.resolve(new Response(list));
    }
    if (urlStr.includes('poetry-180-')) {
      return Promise.resolve(new Response(detail));
    }
    return Promise.resolve(new Response('Not Found', { status: 404 }));
  });
}

describe('scrapeLoc180', () => {
  test('should extract poem correctly', async () => {
    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtml));
      }
      if (urlStr.includes('poetry-180-001')) {
        return Promise.resolve(new Response(detailHtml));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const poems = await scrapeLoc180(1, 1, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Introduction to Poetry');
    expect(poems[0].author).toBe('Billy Collins');
    expect(poems[0].source).toBe('loc-180');
    expect(poems[0].content).toContain('I ask them to take a poem');
    expect(poems[0].sourceUrl).toContain('poetry-180-001');
  });

  // --- Regression tests (3B) ---

  test('range handling: scrapeLoc180(5, 7) fetches exactly poems in range', async () => {
    const fetchCalls: string[] = [];
    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      fetchCalls.push(urlStr);
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtmlRange));
      }
      if (urlStr.includes('poetry-180-')) {
        return Promise.resolve(new Response(detailHtml));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const poems = await scrapeLoc180(5, 7, { fetchImpl: fetchMock as unknown as typeof fetch });

    // 1 list fetch + 3 detail fetches (poems 5, 6, 7)
    const detailCalls = fetchCalls.filter((u) => u.includes('poetry-180-'));
    expect(detailCalls).toHaveLength(3);
    expect(poems).toHaveLength(3);
  });

  test('graceful 404: missing poem filtered out, others still returned', async () => {
    let callCount = 0;
    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtml));
      }
      if (urlStr.includes('poetry-180-001')) {
        return Promise.resolve(new Response(detailHtml));
      }
      if (urlStr.includes('poetry-180-002')) {
        callCount++;
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }));
    });

    const poems = await scrapeLoc180(1, 2, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(callCount).toBe(1); // poem 2 was attempted
    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Introduction to Poetry');
  });

  test('all poems have source loc-180 and isPublicDomain false', async () => {
    const fetchMock = createMockFetch(listHtml, detailHtml);

    const poems = await scrapeLoc180(1, 2, { fetchImpl: fetchMock as unknown as typeof fetch });

    for (const poem of poems) {
      expect(poem.source).toBe('loc-180');
      expect(poem.isPublicDomain).toBe(false);
    }
  });

  test('sourceUrl contains the poem URL', async () => {
    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtml));
      }
      return Promise.resolve(new Response(detailHtml));
    });

    const poems = await scrapeLoc180(1, 2, { fetchImpl: fetchMock as unknown as typeof fetch });

    for (const poem of poems) {
      expect(poem.sourceUrl).toContain('poetry-180-');
    }
  });

  test('fallback extraction: uses title tag when dc.title meta missing', async () => {
    const noMetaHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Fallback Title | Library of Congress</title></head>
      <body>
        <div class="poem"><pre>Some poem content here.</pre></div>
      </body>
      </html>`;

    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtml));
      }
      return Promise.resolve(new Response(noMetaHtml));
    });

    const poems = await scrapeLoc180(1, 1, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('Fallback Title');
  });

  test('fallback content: main-content class when poem pre is missing', async () => {
    const fallbackContentHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="dc.title" content="Fallback Content Poem" />
        <meta name="dc.creator" content="Test Author" />
      </head>
      <body>
        <div class="main-content">
          <h1>Fallback Content Poem</h1>
          <p>Fallback body content here.</p>
        </div>
      </body>
      </html>`;

    const fetchMock = mock((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('all-poems')) {
        return Promise.resolve(new Response(listHtml));
      }
      return Promise.resolve(new Response(fallbackContentHtml));
    });

    const poems = await scrapeLoc180(1, 1, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(poems).toHaveLength(1);
    expect(poems[0].content).toContain('Fallback body content here.');
  });
});
