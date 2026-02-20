import * as cheerio from 'cheerio';
import { ScrapedPoem } from '../types';
import { parsePoemContent } from '../parsers/poem-parser';
import { createRateLimiter } from '../utils/rate-limiter';

const BASE_URL = 'https://poets.org';
const POEMS_LIST_URL = 'https://poets.org/poems';

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

export async function getPoemUrls(maxPages: number = 1): Promise<string[]> {
  const urls: string[] = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${POEMS_LIST_URL}?page=${page}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Failed to fetch ${url}: ${response.status}`);
            continue;
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        // Based on the structure, poems are likely in a table or list
        // Inspecting the view-text output, it looks like a list of links
        // I'll look for links that match /poem/*
        $('a[href^="/poem/"]').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
                urls.push(`${BASE_URL}${href}`);
            }
        });
    } catch (error) {
        console.error(`Error scraping list page ${page}:`, error);
    }
  }

  // Remove duplicates
  return [...new Set(urls)];
}

export async function scrapePoetsOrg(maxPages: number = 1): Promise<ScrapedPoem[]> {
  const urls = await getPoemUrls(maxPages);
  const poemPromises: Promise<ScrapedPoem | null>[] = [];

  for (const url of urls) {
    poemPromises.push(
      limit(async () => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
             console.error(`Failed to fetch ${url}: ${response.status}`);
             return null;
          }
          const html = await response.text();
          const $ = cheerio.load(html);

          let title = $('h1.page-title').text().trim();
          if (!title) title = $('h1').first().text().trim();

          // Author is often linked
          let author = $('a[href^="/poet/"]').first().text().trim();
          if (!author) {
             author = $('.field--name-title').first().text().trim();
          }

          // Content extraction
          // Drupal sites often use field--name-body or field--name-field-poem-body
          let contentHtml = $('.field--name-body').html() || '';
          if (!contentHtml) {
            contentHtml = $('.field--name-field-poem-body').html() || '';
          }
          if (!contentHtml) {
              contentHtml = $('.poem-body').html() || ''; // Fallback
          }
          if (!contentHtml) {
             // Try finding the div that contains the poem lines directly
             // This is heuristic
             contentHtml = $('div[property="content:encoded"]').html() || '';
          }

          const content = parsePoemContent(contentHtml);

          if (!content) {
              return null;
          }

          const themes: string[] = [];
          $('a[href^="/themes/"]').each((_, el) => {
              themes.push($(el).text().trim());
          });

          $('div.field--name-field-poem-themes a').each((_, el) => {
              themes.push($(el).text().trim());
          });

          // Check if public domain. This is hard to detect reliably without specific metadata.
          // But we can check for copyright notices.
          const footerText = $('footer').text();
          const bodyText = $('body').text();
          const isPublicDomain = footerText.includes('Public Domain') ||
                                 bodyText.includes('Public Domain') ||
                                 !bodyText.includes('Copyright');

          return {
            sourceId: generateSourceId('poets.org', url, title),
            source: 'poets.org',
            sourceUrl: url,
            title: title,
            author: author,
            year: null, // Hard to extract reliably without specific selector
            content: content,
            themes: [...new Set(themes)], // Remove duplicates
            form: null,
            isPublicDomain: isPublicDomain,
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
