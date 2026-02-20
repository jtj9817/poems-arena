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
});
