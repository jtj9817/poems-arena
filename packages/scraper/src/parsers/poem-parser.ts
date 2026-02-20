import { extractTagMatches, normalizeWhitespace, stripHtml } from '../utils/html';

export function parsePoemContent(html: string): string {
  const normalizedHtml = html.replace(/<br\s*\/?>/gi, '\n');
  const stanzaMatches = extractTagMatches(normalizedHtml, ['p', 'div']);

  const stanzas = stanzaMatches
    .map((match) => normalizeWhitespace(stripHtml(match.innerHtml).replace(/\r/g, '')))
    .filter((text) => text.length > 0);

  if (stanzas.length > 0) {
    return stanzas.join('\n\n');
  }

  return normalizeWhitespace(stripHtml(normalizedHtml));
}
