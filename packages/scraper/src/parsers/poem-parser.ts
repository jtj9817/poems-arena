import * as cheerio from 'cheerio';

export function parsePoemContent(html: string): string {
  const $ = cheerio.load(html);

  // Replace <br> tags with newline characters
  $('br').replaceWith('\n');

  const stanzas: string[] = [];

  // Iterate over immediate children of body to avoid duplication
  $('body')
    .children()
    .each((_, element) => {
      // Only consider block elements that likely contain text
      // We check for p and div tags
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'p' || tagName === 'div') {
        const text = $(element).text().trim();
        if (text.length > 0) {
          stanzas.push(text);
        }
      }
    });

  return stanzas.join('\n\n');
}
