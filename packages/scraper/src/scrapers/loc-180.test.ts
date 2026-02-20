import { expect, test, describe, spyOn, mock } from 'bun:test';
import { scrapeLoc180 } from './loc-180';

const mockHtml = `
<!DOCTYPE html>
<html>
<head><title>Poem 001: Introduction to Poetry</title></head>
<body>
<div class="main-content">
  <h1>001</h1>
  <h2>Introduction to Poetry</h2>
  <h3>Billy Collins</h3>
  <div class="poem-body">
    <p>I ask them to take a poem</p>
    <p>and hold it up to the light</p>
    <p>like a color slide</p>
    <br>
    <p>or press an ear against its hive.</p>
  </div>
</div>
</body>
</html>
`;

describe('scrapeLoc180', () => {
  test('should extract poem correctly', async () => {
    // Mock the global fetch function
    global.fetch = mock(() =>
      Promise.resolve(new Response(mockHtml))
    );

    // We'll just scrape one poem for the test
    const poems = await scrapeLoc180(1, 1);

    expect(poems).toHaveLength(1);

    expect(poems[0].title).toBe('Introduction to Poetry');
    expect(poems[0].author).toBe('Billy Collins');
    expect(poems[0].source).toBe('loc-180');
    expect(poems[0].content).toContain('I ask them to take a poem');
    expect(poems[0].sourceUrl).toContain('001.html');
  });
});
