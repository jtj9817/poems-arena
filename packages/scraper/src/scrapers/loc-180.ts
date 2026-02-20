import * as cheerio from 'cheerio';
import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';

const BASE_URL = 'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poetry-180/';

const limit = createRateLimiter({ concurrency: 5, minDelay: 200 });

function generateSourceId(source: string, url: string, title: string): string {
  const str = `${source}:${url}:${title}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

export async function scrapeLoc180(start: number = 1, end: number = 180): Promise<ScrapedPoem[]> {
  const poemPromises: Promise<ScrapedPoem | null>[] = [];

  for (let i = start; i <= end; i++) {
    const poemNumber = i.toString().padStart(3, '0');
    const url = `${BASE_URL}${poemNumber}.html`;

    poemPromises.push(
      limit(async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            return null;
          }
          const html = await response.text();
          const $ = cheerio.load(html);

          // Extract title. Often followed by "Poem 001: Title"
          let title = $('h2').first().text().trim();

          // Extract author. Usually "by Author"
          let author = $('h3').first().text().trim();
          author = author.replace(/^by\s+/i, '');

          // Extract content
          // The structure is variable, but often there is a poem-body class or main-content
          let contentHtml = $('.poem-body').html() || '';

          // If poem-body is not found, try to fallback to a reasonable container
          if (!contentHtml) {
             const mainContent = $('.main-content');
             if (mainContent.length) {
                 // Clone to avoid modifying the original
                 const contentClone = mainContent.clone();
                 // Remove headers which are title/author
                 contentClone.find('h1, h2, h3').remove();
                 contentHtml = contentClone.html() || '';
             }
          }

          const content = parsePoemContent(contentHtml);

          if (!content) {
             console.warn(`No content found for ${url}`);
             // If we can't find content, it's better to skip than return empty
             // But we might want to return what we have?
             // For now, return null to be safe
             return null;
          }

          return {
            sourceId: generateSourceId('loc-180', url, title),
            source: 'loc-180',
            sourceUrl: url,
            title: title,
            author: author,
            year: null,
            content: content,
            themes: [],
            form: null,
            isPublicDomain: false, // Most are contemporary
            scrapedAt: new Date().toISOString(),
          };

        } catch (error) {
          console.error(`Error scraping ${url}:`, error);
          return null;
        }
      })
    );
  }

  const results = await Promise.all(poemPromises);
  return results.filter((p): p is ScrapedPoem => p !== null);
}
