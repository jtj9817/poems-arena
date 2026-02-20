import { describe, expect, test } from 'bun:test';
import {
  decodeHtmlEntities,
  stripHtml,
  normalizeWhitespace,
  extractTagMatches,
  extractAnchors,
  extractAnchorsByHrefPrefix,
  extractFirstClassInnerHtml,
  extractFirstTagText,
  extractFirstTagTextByClass,
  hasCaseInsensitiveText,
  removeTags,
} from './html';

describe('decodeHtmlEntities', () => {
  test('decodes named entities', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&lt;')).toBe('<');
    expect(decodeHtmlEntities('&gt;')).toBe('>');
    expect(decodeHtmlEntities('&quot;')).toBe('"');
    expect(decodeHtmlEntities('&#39;')).toBe("'");
    expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
  });

  test('decodes numeric character references', () => {
    expect(decodeHtmlEntities('&#65;')).toBe('A');
    expect(decodeHtmlEntities('&#8212;')).toBe('\u2014'); // em dash
  });

  test('passes through plain text unchanged', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world');
  });

  test('handles multiple entities in one string', () => {
    expect(decodeHtmlEntities('a &amp; b &lt; c')).toBe('a & b < c');
  });
});

describe('stripHtml', () => {
  test('strips simple tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
  });

  test('strips nested tags', () => {
    expect(stripHtml('<div><p><em>Hello</em> World</p></div>')).toBe('Hello World');
  });

  test('decodes entities after stripping', () => {
    expect(stripHtml('<p>a &amp; b</p>')).toBe('a & b');
  });

  test('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('normalizeWhitespace', () => {
  test('collapses spaces and tabs', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
    expect(normalizeWhitespace('hello\tworld')).toBe('hello world');
    expect(normalizeWhitespace('hello \t  world')).toBe('hello world');
  });

  test('collapses 3+ newlines to 2', () => {
    expect(normalizeWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizeWhitespace('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  test('preserves double newlines', () => {
    expect(normalizeWhitespace('a\n\nb')).toBe('a\n\nb');
  });

  test('removes carriage returns', () => {
    expect(normalizeWhitespace('hello\r\nworld')).toBe('hello\nworld');
  });

  test('trims leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });
});

describe('extractTagMatches', () => {
  test('extracts multiple same-type tags', () => {
    const html = '<p>first</p><p>second</p>';
    const matches = extractTagMatches(html, ['p']);
    expect(matches).toHaveLength(2);
    expect(matches[0].innerHtml).toBe('first');
    expect(matches[1].innerHtml).toBe('second');
  });

  test('extracts mixed tag types', () => {
    const html = '<h2>Title</h2><p>Content</p><h3>Subtitle</h3>';
    const matches = extractTagMatches(html, ['h2', 'h3']);
    expect(matches).toHaveLength(2);
    expect(matches[0].tagName).toBe('h2');
    expect(matches[0].innerHtml).toBe('Title');
    expect(matches[1].tagName).toBe('h3');
    expect(matches[1].innerHtml).toBe('Subtitle');
  });

  test('captures attributes', () => {
    const html = '<div class="poem" id="main">Content</div>';
    const matches = extractTagMatches(html, ['div']);
    expect(matches).toHaveLength(1);
    expect(matches[0].attributes).toContain('class="poem"');
  });

  test('returns empty array for empty input', () => {
    expect(extractTagMatches('', ['p'])).toHaveLength(0);
  });

  test('returns empty array for empty tagNames', () => {
    expect(extractTagMatches('<p>test</p>', [])).toHaveLength(0);
  });

  test('includes start and end positions', () => {
    const html = '<p>hello</p>';
    const matches = extractTagMatches(html, ['p']);
    expect(matches[0].start).toBe(0);
    expect(matches[0].end).toBe(html.length);
  });
});

describe('extractAnchors', () => {
  test('extracts href and text from anchors', () => {
    const html = '<a href="/poem/1">First Poem</a><a href="/poem/2">Second Poem</a>';
    const anchors = extractAnchors(html);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toEqual({ href: '/poem/1', text: 'First Poem' });
    expect(anchors[1]).toEqual({ href: '/poem/2', text: 'Second Poem' });
  });

  test('strips nested HTML from anchor text', () => {
    const html = '<a href="/test"><strong>Bold</strong> Link</a>';
    const anchors = extractAnchors(html);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].text).toBe('Bold Link');
  });

  test('skips anchors without href', () => {
    const html = '<a>No href</a><a href="/valid">Valid</a>';
    const anchors = extractAnchors(html);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe('/valid');
  });

  test('returns empty array for no anchors', () => {
    expect(extractAnchors('<p>No links</p>')).toHaveLength(0);
  });
});

describe('extractAnchorsByHrefPrefix', () => {
  test('filters by href prefix', () => {
    const html = '<a href="/poem/1">Poem</a><a href="/poet/1">Poet</a><a href="/poem/2">Poem 2</a>';
    const anchors = extractAnchorsByHrefPrefix(html, '/poem/');
    expect(anchors).toHaveLength(2);
    expect(anchors[0].href).toBe('/poem/1');
    expect(anchors[1].href).toBe('/poem/2');
  });

  test('returns empty array when no matches', () => {
    const html = '<a href="/other/1">Other</a>';
    expect(extractAnchorsByHrefPrefix(html, '/poem/')).toHaveLength(0);
  });
});

describe('extractFirstClassInnerHtml', () => {
  test('extracts inner HTML of first matching class', () => {
    const html = '<div class="poem-body"><p>Content</p></div>';
    const result = extractFirstClassInnerHtml(html, ['poem-body']);
    expect(result).toBe('<p>Content</p>');
  });

  test('returns empty string when no match', () => {
    const html = '<div class="other">Content</div>';
    expect(extractFirstClassInnerHtml(html, ['poem-body'])).toBe('');
  });

  test('returns first match when multiple classes given', () => {
    const html = '<div class="fallback">Fallback</div><div class="primary">Primary</div>';
    const result = extractFirstClassInnerHtml(html, ['primary', 'fallback']);
    // CSS selector order: `.primary, .fallback` — cheerio returns DOM order
    expect(result).toBe('Fallback');
  });

  test('tries multiple class selectors', () => {
    const html = '<div class="second-choice">Found</div>';
    const result = extractFirstClassInnerHtml(html, ['first-choice', 'second-choice']);
    expect(result).toBe('Found');
  });
});

describe('extractFirstTagText', () => {
  test('extracts text from first matching tag', () => {
    const html = '<h1>Title</h1><h2>Subtitle</h2>';
    expect(extractFirstTagText(html, ['h1'])).toBe('Title');
  });

  test('returns empty string when no match', () => {
    expect(extractFirstTagText('<p>text</p>', ['h1'])).toBe('');
  });

  test('tries multiple tag names', () => {
    const html = '<h2>Found</h2>';
    expect(extractFirstTagText(html, ['h1', 'h2'])).toBe('Found');
  });
});

describe('extractFirstTagTextByClass', () => {
  test('extracts text from tag+class combo', () => {
    const html = '<h1 class="page-title">My Page</h1>';
    expect(extractFirstTagTextByClass(html, 'h1', 'page-title')).toBe('My Page');
  });

  test('returns empty string when tag exists but class does not match', () => {
    const html = '<h1 class="other">Title</h1>';
    expect(extractFirstTagTextByClass(html, 'h1', 'page-title')).toBe('');
  });

  test('returns empty string when no match at all', () => {
    expect(extractFirstTagTextByClass('<p>text</p>', 'h1', 'page-title')).toBe('');
  });
});

describe('hasCaseInsensitiveText', () => {
  test('returns true when phrase is found (case insensitive)', () => {
    expect(hasCaseInsensitiveText('This is Public Domain', 'public domain')).toBe(true);
  });

  test('returns false when phrase is not found', () => {
    expect(hasCaseInsensitiveText('All rights reserved', 'public domain')).toBe(false);
  });

  test('strips HTML before checking', () => {
    expect(hasCaseInsensitiveText('<p>Public Domain</p>', 'public domain')).toBe(true);
  });

  test('handles empty inputs', () => {
    expect(hasCaseInsensitiveText('', 'test')).toBe(false);
    expect(hasCaseInsensitiveText('test', '')).toBe(true);
  });
});

describe('removeTags', () => {
  test('removes specified tags and their content', () => {
    const html = '<div><p>Keep</p><script>remove</script></div>';
    const result = removeTags(html, ['script']);
    expect(result).toContain('Keep');
    expect(result).not.toContain('remove');
    expect(result).not.toContain('<script');
  });

  test('preserves surrounding content', () => {
    const html = '<div>before<h1>title</h1>after</div>';
    const result = removeTags(html, ['h1']);
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toContain('<h1');
  });

  test('removes multiple tag types', () => {
    const html = '<div><h1>Title</h1><h2>Sub</h2><p>Content</p></div>';
    const result = removeTags(html, ['h1', 'h2']);
    expect(result).not.toContain('Title');
    expect(result).not.toContain('Sub');
    expect(result).toContain('Content');
  });

  test('handles no matching tags gracefully', () => {
    const html = '<p>Content</p>';
    const result = removeTags(html, ['script']);
    expect(result).toContain('Content');
  });
});
