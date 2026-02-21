import { describe, expect, test } from 'bun:test';
import {
  normalizeDedupKey,
  isFuzzyMatch,
  levenshteinDistance,
  resolveDuplicates,
} from './02-dedup';
import type { CleanPoem } from './01-clean';

describe('normalizeDedupKey', () => {
  test('lowercases and normalizes unicode', () => {
    expect(normalizeDedupKey('Café')).toBe('cafe');
  });

  test('collapses whitespace', () => {
    expect(normalizeDedupKey('  hello   world  ')).toBe('hello world');
  });

  test('removes punctuation', () => {
    expect(normalizeDedupKey('Ode to a Nightingale, Part 1.')).toBe('ode to a nightingale part 1');
    expect(normalizeDedupKey('Summer’s Day')).toBe('summers day');
  });

  test('strips leading articles', () => {
    expect(normalizeDedupKey('The Raven')).toBe('raven');
    expect(normalizeDedupKey('A Dream Within a Dream')).toBe('dream within a dream');
    expect(normalizeDedupKey('An Evening Walk')).toBe('evening walk');
  });
});

describe('levenshteinDistance', () => {
  test('computes distance correctly', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('a', '')).toBe(1);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('flitten', 'flitten')).toBe(0);
  });
});

describe('isFuzzyMatch', () => {
  test('exact match', () => {
    expect(isFuzzyMatch('raven', 'raven')).toBe(true);
  });

  test('suffix variants', () => {
    expect(isFuzzyMatch('raven', 'raven excerpt')).toBe(true);
    expect(isFuzzyMatch('raven fragment', 'raven')).toBe(true);
    expect(isFuzzyMatch('raven', 'raven selection')).toBe(true);
    expect(isFuzzyMatch('raven excerpt', 'raven fragment')).toBe(false); // Only one suffix removed matches base
  });

  test('small typos on longer strings', () => {
    expect(isFuzzyMatch('rime of ancient mariner', 'rime of the ancient mariner')).toBe(false); // wait, "the" is inside, diff is 4 " the"
    expect(isFuzzyMatch('annabel lee', 'anabel lee')).toBe(true); // dist 1
    expect(isFuzzyMatch('sonnet 18 summers day', 'sonnet 18 sumers day')).toBe(true); // dist 1
  });

  test('rejects typos on short strings', () => {
    expect(isFuzzyMatch('cat', 'bat')).toBe(false); // short strings don't use typo allowance
    expect(isFuzzyMatch('dream', 'dreams')).toBe(false);
  });
});

describe('resolveDuplicates', () => {
  const basePoem: CleanPoem = {
    sourceId: '1',
    source: 'gutenberg',
    sourceUrl: 'http://gutenberg/1',
    title: 'Title',
    author: 'Author',
    year: '1900',
    content: 'Line 1\nLine 2',
    themes: ['love'],
    form: 'sonnet',
    isPublicDomain: true,
    scrapedAt: '2026-01-01T00:00:00Z',
  };

  test('returns single canonical poem for one entry', () => {
    const res = resolveDuplicates([basePoem]);
    expect(res.title).toBe('Title');
    expect(res.provenances.length).toBe(1);
  });

  test('prioritizes poets.org over gutenberg', () => {
    const p1 = { ...basePoem, source: 'gutenberg' as const, content: 'Bad content' };
    const p2 = {
      ...basePoem,
      source: 'poets.org' as const,
      content: 'Good content',
      sourceId: '2',
      sourceUrl: 'http://poets.org/2',
    };

    const res = resolveDuplicates([p1, p2]);
    expect(res.content).toBe('Good content');
    expect(res.provenances.length).toBe(2);
    expect(res.provenances.some((p) => p.source === 'poets.org')).toBe(true);
    expect(res.provenances.some((p) => p.source === 'gutenberg')).toBe(true);
  });

  test('deduplicates identical provenances', () => {
    const p1 = { ...basePoem };
    const p2 = { ...basePoem };
    const res = resolveDuplicates([p1, p2]);
    expect(res.provenances.length).toBe(1);
  });
});
