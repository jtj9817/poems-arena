/**
 * Shape-validation tests for @sanctuary/shared types.
 *
 * These tests verify that the exported interfaces can be constructed with their
 * required and optional fields, and that the values round-trip correctly.
 * TypeScript compilation itself is the primary type-safety gate; these tests
 * provide a secondary runtime sanity check.
 */
import { describe, expect, test } from 'bun:test';
import type { SourceInfo, TopicMeta } from './index';
import { AuthorType, sanitizeExternalHttpUrl } from './index';

describe('TopicMeta', () => {
  test('can be constructed with a non-null id and label', () => {
    const meta: TopicMeta = { id: 'topic-nature', label: 'Nature' };
    expect(meta.id).toBe('topic-nature');
    expect(meta.label).toBe('Nature');
  });

  test('can be constructed with a null id', () => {
    const meta: TopicMeta = { id: null, label: 'Unknown' };
    expect(meta.id).toBeNull();
    expect(meta.label).toBe('Unknown');
  });
});

describe('SourceInfo', () => {
  test('can be constructed with primary source and empty provenances', () => {
    const info: SourceInfo = {
      primary: { source: 'Poetry Foundation', sourceUrl: 'https://poetryfoundation.org' },
      provenances: [],
    };
    expect(info.primary.source).toBe('Poetry Foundation');
    expect(info.primary.sourceUrl).toBe('https://poetryfoundation.org');
    expect(info.provenances).toHaveLength(0);
  });

  test('can be constructed with null primary fields (AI poem)', () => {
    const info: SourceInfo = {
      primary: { source: null, sourceUrl: null },
      provenances: [],
    };
    expect(info.primary.source).toBeNull();
    expect(info.primary.sourceUrl).toBeNull();
  });

  test('can hold multiple provenance entries', () => {
    const info: SourceInfo = {
      primary: { source: 'Gutenberg', sourceUrl: 'https://gutenberg.org/poem/1' },
      provenances: [
        {
          source: 'Gutenberg',
          sourceUrl: 'https://gutenberg.org/poem/1',
          scrapedAt: '2024-01-01T00:00:00.000Z',
          isPublicDomain: true,
        },
        {
          source: 'LOC',
          sourceUrl: 'https://loc.gov/poem/1',
          scrapedAt: '2024-06-01T00:00:00.000Z',
          isPublicDomain: true,
        },
      ],
    };
    expect(info.provenances).toHaveLength(2);
    expect(info.provenances[0].source).toBe('Gutenberg');
    expect(info.provenances[1].source).toBe('LOC');
  });
});

describe('Poem with sourceInfo', () => {
  test('Poem can be constructed without sourceInfo (optional)', () => {
    const poem = {
      id: 'p1',
      title: 'Test',
      content: 'Content',
      author: 'Author',
      type: AuthorType.HUMAN,
    };
    expect(poem.id).toBe('p1');
    // sourceInfo not present — check it is indeed absent
    expect('sourceInfo' in poem).toBe(false);
  });

  test('Poem can be constructed with sourceInfo', () => {
    const poem = {
      id: 'p1',
      title: 'Test',
      content: 'Content',
      author: 'Author',
      type: AuthorType.HUMAN,
      sourceInfo: {
        primary: { source: 'PF', sourceUrl: 'https://pf.org' },
        provenances: [],
      } satisfies SourceInfo,
    };
    expect(poem.sourceInfo.primary.source).toBe('PF');
  });
});

describe('sanitizeExternalHttpUrl', () => {
  test('keeps valid https URL', () => {
    expect(sanitizeExternalHttpUrl('https://poetryfoundation.org/poems/1')).toBe(
      'https://poetryfoundation.org/poems/1',
    );
  });

  test('keeps valid http URL', () => {
    expect(sanitizeExternalHttpUrl('http://example.com/path')).toBe('http://example.com/path');
  });

  test('rejects javascript protocol', () => {
    expect(sanitizeExternalHttpUrl("javascript:alert('xss')")).toBeNull();
  });

  test('rejects non-http protocols', () => {
    expect(sanitizeExternalHttpUrl('data:text/html,hi')).toBeNull();
  });

  test('rejects invalid and empty URLs', () => {
    expect(sanitizeExternalHttpUrl('not-a-url')).toBeNull();
    expect(sanitizeExternalHttpUrl('   ')).toBeNull();
    expect(sanitizeExternalHttpUrl(null)).toBeNull();
  });
});
