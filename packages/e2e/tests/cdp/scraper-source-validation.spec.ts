import { test, expect } from '@playwright/test';
import { createCDPSession, querySelectorAllViaDOM } from '../../lib/cdp-helpers';
import {
  GUTENBERG_EMERSON_URL,
  LOC_180_ALL_POEMS_URL,
  POETS_ORG_POEMS_URL,
  POETS_ORG_CONTENT_CLASSES,
} from '../../lib/fixtures';

const skipLive = process.env.SKIP_LIVE_CDP === 'true';
const testOrSkip = skipLive ? test.skip : test;

test.describe('Scraper source page structural validation (CDP)', () => {
  testOrSkip('Gutenberg Emerson page has h2/h3 headings for poem titles', async ({ page }) => {
    await page.goto(GUTENBERG_EMERSON_URL, { waitUntil: 'domcontentloaded' });

    const session = await createCDPSession(page);
    const h2s = await querySelectorAllViaDOM(session, 'h2');
    const h3s = await querySelectorAllViaDOM(session, 'h3');

    // Emerson collection should have multiple headings
    expect(h2s.length + h3s.length).toBeGreaterThan(0);
  });

  testOrSkip('LOC Poetry 180 all-poems page has poem links', async ({ page }) => {
    await page.goto(LOC_180_ALL_POEMS_URL, { waitUntil: 'domcontentloaded' });

    const session = await createCDPSession(page);
    const poemLinks = await querySelectorAllViaDOM(session, 'a[href*="poetry-180-"]');

    expect(poemLinks.length).toBeGreaterThan(0);
  });

  testOrSkip('Poets.org list page has a[href^="/poem/"] links', async ({ page }) => {
    await page.goto(POETS_ORG_POEMS_URL, { waitUntil: 'domcontentloaded' });

    const session = await createCDPSession(page);
    const poemLinks = await querySelectorAllViaDOM(session, 'a[href^="/poem/"]');

    expect(poemLinks.length).toBeGreaterThan(0);
  });

  testOrSkip('Poets.org detail page has at least one content body class', async ({ page }) => {
    // First get a poem URL from the list page
    await page.goto(POETS_ORG_POEMS_URL, { waitUntil: 'domcontentloaded' });

    const poemHref = await page.evaluate(() => {
      const link = document.querySelector('a[href^="/poem/"]');
      return link?.getAttribute('href') ?? null;
    });

    test.skip(!poemHref, 'No poem links found on list page');

    await page.goto(`https://poets.org${poemHref}`, { waitUntil: 'domcontentloaded' });

    const session = await createCDPSession(page);
    const classSelector = POETS_ORG_CONTENT_CLASSES.map((c) => `.${c}`).join(', ');
    const matches = await querySelectorAllViaDOM(session, classSelector);

    expect(matches.length).toBeGreaterThan(0);
  });
});
