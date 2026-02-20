import * as cheerio from 'cheerio';

interface HtmlTagMatch {
  attributes: string;
  end: number;
  innerHtml: string;
  start: number;
  tagName: string;
}

interface HtmlAnchor {
  href: string;
  text: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function decodeHtmlEntities(value: string): string {
  // Use cheerio to decode entities properly if needed, but simple replacement is fine for now
  // or use a library. For now, keep existing logic or use cheerio.load(value).text()
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, numericCode: string) => {
      const codePoint = Number.parseInt(numericCode, 10);
      return Number.isNaN(codePoint) ? '' : String.fromCodePoint(codePoint);
    });
}

export function stripHtml(value: string): string {
  return cheerio.load(value).text() || '';
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts tag matches with their start/end indices in the source string.
 * This uses regex and is intended for use cases where source position matters (e.g. slicing).
 * For DOM parsing, use cheerio-based functions.
 */
export function extractTagMatches(html: string, tagNames: string[]): HtmlTagMatch[] {
  if (tagNames.length === 0) {
    return [];
  }

  const tagPattern = tagNames.map((tagName) => escapeRegExp(tagName)).join('|');
  const regex = new RegExp(`<(${tagPattern})([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'gi');
  const matches: HtmlTagMatch[] = [];

  let match = regex.exec(html);
  while (match) {
    matches.push({
      attributes: match[2] || '',
      end: regex.lastIndex,
      innerHtml: match[3] || '',
      start: match.index,
      tagName: match[1].toLowerCase(),
    });
    match = regex.exec(html);
  }

  return matches;
}

export function loadHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

export function extractAnchors(html: string): HtmlAnchor[] {
  const $ = loadHtml(html);
  const anchors: HtmlAnchor[] = [];
  $('a').each((_, element) => {
    const el = $(element);
    const href = el.attr('href');
    if (href) {
      anchors.push({
        href,
        text: normalizeWhitespace(el.text()),
      });
    }
  });
  return anchors;
}

export function extractAnchorsByHrefPrefix(html: string, prefix: string): HtmlAnchor[] {
  return extractAnchors(html).filter((anchor) => anchor.href.startsWith(prefix));
}

export function extractFirstClassInnerHtml(html: string, classNames: string[]): string {
  const $ = loadHtml(html);
  const selector = classNames.map((c) => `.${c}`).join(', ');
  return $(selector).first().html() || '';
}

export function extractFirstTagText(html: string, tagNames: string[]): string {
  const $ = loadHtml(html);
  const selector = tagNames.join(', ');
  return normalizeWhitespace($(selector).first().text());
}

export function extractFirstTagTextByClass(
  html: string,
  tagName: string,
  className: string,
): string {
  const $ = loadHtml(html);
  const selector = `${tagName}.${className}`;
  return normalizeWhitespace($(selector).first().text());
}

export function hasCaseInsensitiveText(htmlOrText: string, phrase: string): boolean {
  return stripHtml(htmlOrText).toLowerCase().includes(phrase.toLowerCase());
}

export function removeTags(html: string, tagNames: string[]): string {
  const $ = loadHtml(html);
  const selector = tagNames.join(', ');
  $(selector).remove();
  return $.html();
}
