import { describe, expect, test } from 'bun:test';
import { countNonEmptyLines, normalizeWhitespace, stripHtml, validateAndClean } from './01-clean';

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------

describe('stripHtml', () => {
  test('leaves plain text unchanged', () => {
    expect(stripHtml('Hello world')).toBe('Hello world');
  });

  test('strips HTML tags', () => {
    expect(stripHtml('<b>Bold</b> text')).toBe('Bold text');
    expect(stripHtml('<em>italic</em>')).toBe('italic');
    expect(stripHtml('<span class="x">foo</span>')).toBe('foo');
  });

  test('decodes common named HTML entities', () => {
    expect(stripHtml('&amp;')).toBe('&');
    expect(stripHtml('&lt;life&gt;')).toBe('<life>');
    expect(stripHtml('&quot;hello&quot;')).toBe('"hello"');
    expect(stripHtml('&apos;hello&apos;')).toBe("'hello'");
    expect(stripHtml('&nbsp;')).toBe(' ');
  });

  test('decodes numeric decimal entities', () => {
    expect(stripHtml('&#8212;')).toBe('\u2014'); // em dash
    expect(stripHtml('&#8217;')).toBe('\u2019'); // right single quotation
  });

  test('decodes numeric hex entities', () => {
    expect(stripHtml('&#x2014;')).toBe('\u2014'); // em dash
    expect(stripHtml('&#x2019;')).toBe('\u2019'); // right single quotation
  });

  test('strips nested tags and decodes entities together', () => {
    expect(stripHtml('<p><em>Eternal &amp; wild</em></p>')).toBe('Eternal & wild');
  });
});

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------

describe('normalizeWhitespace', () => {
  test('collapses multiple spaces within a line to one', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
  });

  test('trims leading and trailing whitespace from the whole text', () => {
    expect(normalizeWhitespace('  hello world  ')).toBe('hello world');
  });

  test('trims leading and trailing whitespace from each line', () => {
    expect(normalizeWhitespace('  line one  \n  line two  ')).toBe('line one\nline two');
  });

  test('normalizes Windows CRLF to LF', () => {
    expect(normalizeWhitespace('line one\r\nline two')).toBe('line one\nline two');
  });

  test('converts tab characters to a single space', () => {
    expect(normalizeWhitespace('hello\tworld')).toBe('hello world');
  });

  test('preserves single newlines between lines (intra-stanza)', () => {
    const input = 'line one\nline two\nline three';
    expect(normalizeWhitespace(input)).toBe('line one\nline two\nline three');
  });

  test('normalizes multiple blank lines to a single double-newline (stanza break)', () => {
    expect(normalizeWhitespace('stanza one\n\n\n\nstanza two')).toBe('stanza one\n\nstanza two');
  });

  test('does not introduce trailing or leading blank lines', () => {
    const result = normalizeWhitespace('\n\npoem content\n\n');
    expect(result.startsWith('\n')).toBe(false);
    expect(result.endsWith('\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countNonEmptyLines
// ---------------------------------------------------------------------------

describe('countNonEmptyLines', () => {
  test('counts non-empty lines across multiple stanzas', () => {
    const content = 'line one\nline two\n\nline three\nline four';
    expect(countNonEmptyLines(content)).toBe(4);
  });

  test('returns 0 for an empty string', () => {
    expect(countNonEmptyLines('')).toBe(0);
  });

  test('treats lines containing only whitespace as empty', () => {
    expect(countNonEmptyLines('real line\n   \nanother line')).toBe(2);
  });

  test('counts a single line poem correctly', () => {
    expect(countNonEmptyLines('one line')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validateAndClean
// ---------------------------------------------------------------------------

const makeRaw = (overrides: Record<string, unknown> = {}) => ({
  sourceId: 'abc123',
  source: 'gutenberg',
  sourceUrl: 'https://gutenberg.org/poem/1',
  title: 'The Road',
  author: 'Ralph Waldo Emerson',
  year: '1847',
  content: 'Line one\nLine two\nLine three\nLine four',
  themes: ['nature', 'travel'],
  form: 'free-verse',
  isPublicDomain: true,
  scrapedAt: '2026-02-01T12:00:00.000Z',
  ...overrides,
});

describe('validateAndClean', () => {
  test('returns a CleanPoem for a fully valid ScrapedPoem', () => {
    const result = validateAndClean(makeRaw());
    expect(result).not.toBeNull();
    expect(result!.title).toBe('The Road');
    expect(result!.author).toBe('Ralph Waldo Emerson');
  });

  test('returns null and does not throw when title is an empty string', () => {
    const result = validateAndClean(makeRaw({ title: '' }));
    expect(result).toBeNull();
  });

  test('returns null when content is an empty string', () => {
    const result = validateAndClean(makeRaw({ content: '' }));
    expect(result).toBeNull();
  });

  test('returns null when poem has fewer than 4 non-empty lines', () => {
    const result = validateAndClean(makeRaw({ content: 'line one\nline two\nline three' }));
    expect(result).toBeNull();
  });

  test('returns null when poem has exactly 4 non-empty lines (boundary)', () => {
    const result = validateAndClean(
      makeRaw({ content: 'line one\nline two\nline three\nline four' }),
    );
    expect(result).not.toBeNull();
  });

  test('normalizes excess whitespace in title', () => {
    const result = validateAndClean(makeRaw({ title: '  The   Road  ' }));
    expect(result!.title).toBe('The Road');
  });

  test('normalizes excess whitespace in author', () => {
    const result = validateAndClean(makeRaw({ author: '  Ralph   Waldo   Emerson  ' }));
    expect(result!.author).toBe('Ralph Waldo Emerson');
  });

  test('normalizes stanza breaks in content', () => {
    const raw = makeRaw({
      content: 'line one\nline two\n\n\n\nline three\nline four',
    });
    const result = validateAndClean(raw);
    expect(result!.content).toBe('line one\nline two\n\nline three\nline four');
  });

  test('strips HTML tags from content', () => {
    const raw = makeRaw({
      content: '<p>line one</p>\n<p>line two</p>\nline three\nline four',
    });
    const result = validateAndClean(raw);
    expect(result!.content).toContain('line one');
    expect(result!.content).not.toContain('<p>');
  });

  test('applies NFC Unicode normalization to title and content', () => {
    // "é" can be represented as precomposed (U+00E9) or decomposed (U+0065 + U+0301)
    const decomposed = 'e\u0301'; // NFD "é"
    const composed = '\u00E9'; // NFC "é"
    const raw = makeRaw({
      title: `Po${decomposed}me`,
      content: 'line one\nline two\nline three\nline four',
    });
    const result = validateAndClean(raw);
    expect(result!.title).toBe(`Po${composed}me`);
  });

  test('preserves provenance fields unchanged', () => {
    const raw = makeRaw();
    const result = validateAndClean(raw);
    expect(result!.sourceId).toBe('abc123');
    expect(result!.source).toBe('gutenberg');
    expect(result!.sourceUrl).toBe('https://gutenberg.org/poem/1');
    expect(result!.isPublicDomain).toBe(true);
    expect(result!.scrapedAt).toBe('2026-02-01T12:00:00.000Z');
  });

  test('preserves themes array unchanged', () => {
    const raw = makeRaw({ themes: ['nature', 'travel'] });
    const result = validateAndClean(raw);
    expect(result!.themes).toEqual(['nature', 'travel']);
  });

  test('returns null for non-object input', () => {
    expect(validateAndClean(null)).toBeNull();
    expect(validateAndClean(undefined)).toBeNull();
    expect(validateAndClean('not an object')).toBeNull();
  });

  test('returns null when a required field (sourceId) is missing', () => {
    const raw = makeRaw() as Record<string, unknown>;
    delete raw.sourceId;
    expect(validateAndClean(raw)).toBeNull();
  });
});
