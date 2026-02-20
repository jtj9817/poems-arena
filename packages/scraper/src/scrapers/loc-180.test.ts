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

describe('scrapeLoc180', () => {
  test('should extract poem correctly', async () => {
    // Mock fetch
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
});
