import { describe, expect, mock, test } from 'bun:test';
import { GUTENBERG_EMERSON_URL, scrapeGutenbergEmerson } from './gutenberg';

const mockHtml = `
<!DOCTYPE html>
<html>
<head><title>Poems by Ralph Waldo Emerson</title></head>
<body>
<div class="chapter">
  <h2>THE RHODORA</h2>
  <p>ON BEING ASKED, WHENCE IS THE FLOWER?</p>
  <p>In May, when sea-winds pierced our solitudes,</p>
  <p>I found the fresh Rhodora in the woods,</p>
  <p>Spreading its leafless blooms in a damp nook,</p>
  <p>To please the desert and the sluggish brook.</p>
</div>
<div class="chapter">
  <h2>THE HUMBLE-BEE</h2>
  <p>Burly, dozing humble-bee,</p>
  <p>Where thou art is clime for me.</p>
  <p>Let them sail for Porto Rique,</p>
  <p>Far-off heats through seas to seek;</p>
</div>
</body>
</html>
`;

describe('scrapeGutenbergEmerson', () => {
  test('uses the documented Poems by Emerson Gutenberg URL', () => {
    expect(GUTENBERG_EMERSON_URL).toBe('https://www.gutenberg.org/files/12843/12843-h/12843-h.htm');
  });

  test('should extract poems correctly', async () => {
    global.fetch = mock(() => Promise.resolve(new Response(mockHtml)));

    const poems = await scrapeGutenbergEmerson('https://example.com/emerson');

    expect(poems).toHaveLength(2);

    expect(poems[0].title).toBe('THE RHODORA');
    expect(poems[0].author).toBe('Ralph Waldo Emerson');
    expect(poems[0].source).toBe('gutenberg');
    expect(poems[0].content).toContain('In May, when sea-winds pierced our solitudes,');
    expect(poems[0].isPublicDomain).toBe(true);

    expect(poems[1].title).toBe('THE HUMBLE-BEE');
    expect(poems[1].content).toContain('Burly, dozing humble-bee,');
  });

  test('should return empty array on fetch failure', async () => {
    global.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' })),
    );

    const poems = await scrapeGutenbergEmerson('https://example.com/emerson-404');
    expect(poems).toHaveLength(0);
  });

  // --- Regression tests (3B) ---

  test('excludes CONTENTS, NOTES, PREFACE, APPENDIX headings', async () => {
    const htmlWithExcluded = `
      <html><body>
        <h2>CONTENTS</h2><p>Table of contents...</p>
        <h2>PREFACE</h2><p>Preface text...</p>
        <h2>ACTUAL POEM</h2><p>Real poem content here.</p>
        <h2>NOTES</h2><p>Notes text...</p>
        <h2>APPENDIX</h2><p>Appendix text...</p>
      </body></html>`;
    const fetchMock = mock(() => Promise.resolve(new Response(htmlWithExcluded)));

    const poems = await scrapeGutenbergEmerson('https://example.com/test', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('ACTUAL POEM');
  });

  test('skips empty content between headings', async () => {
    const htmlWithEmpty = `
      <html><body>
        <h2>EMPTY POEM</h2>
        <h2>REAL POEM</h2>
        <p>Real content here.</p>
      </body></html>`;
    const fetchMock = mock(() => Promise.resolve(new Response(htmlWithEmpty)));

    const poems = await scrapeGutenbergEmerson('https://example.com/test', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(poems).toHaveLength(1);
    expect(poems[0].title).toBe('REAL POEM');
  });

  test('all poems have correct source, author, and isPublicDomain', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(mockHtml)));

    const poems = await scrapeGutenbergEmerson('https://example.com/emerson', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    for (const poem of poems) {
      expect(poem.source).toBe('gutenberg');
      expect(poem.author).toBe('Ralph Waldo Emerson');
      expect(poem.isPublicDomain).toBe(true);
    }
  });

  test('sourceId is deterministic — same HTML produces identical IDs', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(mockHtml)));

    const poems1 = await scrapeGutenbergEmerson('https://example.com/emerson', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const poems2 = await scrapeGutenbergEmerson('https://example.com/emerson', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(poems1.map((p) => p.sourceId)).toEqual(poems2.map((p) => p.sourceId));
  });

  test('network exception (fetch throws) returns [], does not throw', async () => {
    const fetchMock = mock(() => Promise.reject(new Error('Network failure')));

    const poems = await scrapeGutenbergEmerson('https://example.com/fail', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(poems).toEqual([]);
  });

  test('custom fetchImpl option is respected', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(mockHtml)));

    await scrapeGutenbergEmerson('https://example.com/custom', {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/custom');
  });
});
