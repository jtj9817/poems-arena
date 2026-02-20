import { expect, test, describe, spyOn, mock } from 'bun:test';
import { scrapeGutenbergEmerson } from './gutenberg';

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
  test('should extract poems correctly', async () => {
    // Mock the global fetch function
    global.fetch = mock(() =>
      Promise.resolve(new Response(mockHtml))
    );

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
      Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }))
    );

    const poems = await scrapeGutenbergEmerson('https://example.com/emerson-404');
    expect(poems).toHaveLength(0);
  });
});
