import { describe, expect, test } from 'bun:test';
import {
  CANONICAL_TOPICS,
  TOPIC_LABELS,
  MAX_TOPICS,
  mapThemesToTopics,
  extractTopicsFromKeywords,
  assignTopics,
  type CanonicalTopic,
} from '../mappings/theme-to-topic';
import { TagPoemSchema } from './03-tag';
import type { DedupPoem } from './02-dedup';

// ---------------------------------------------------------------------------
// CANONICAL_TOPICS
// ---------------------------------------------------------------------------

describe('CANONICAL_TOPICS', () => {
  test('contains exactly 20 topics', () => {
    expect(CANONICAL_TOPICS.length).toBe(20);
  });

  test('contains all topics from Plan 001', () => {
    const expected: CanonicalTopic[] = [
      'nature',
      'mortality',
      'love',
      'time',
      'loss',
      'identity',
      'war',
      'faith',
      'beauty',
      'solitude',
      'memory',
      'childhood',
      'the-sea',
      'night',
      'grief',
      'desire',
      'home',
      'myth',
      'dreams',
      'rebellion',
    ];
    for (const topic of expected) {
      expect(CANONICAL_TOPICS).toContain(topic);
    }
  });
});

// ---------------------------------------------------------------------------
// TOPIC_LABELS
// ---------------------------------------------------------------------------

describe('TOPIC_LABELS', () => {
  test('has a label for every canonical topic', () => {
    for (const topic of CANONICAL_TOPICS) {
      expect(TOPIC_LABELS[topic]).toBeTruthy();
    }
  });

  test('labels are non-empty strings', () => {
    for (const topic of CANONICAL_TOPICS) {
      expect(typeof TOPIC_LABELS[topic]).toBe('string');
      expect(TOPIC_LABELS[topic].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_TOPICS
// ---------------------------------------------------------------------------

describe('MAX_TOPICS', () => {
  test('is 3', () => {
    expect(MAX_TOPICS).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// mapThemesToTopics
// ---------------------------------------------------------------------------

describe('mapThemesToTopics', () => {
  // Plan 001 explicit mappings
  test('"Nature" maps to nature', () => {
    expect(mapThemesToTopics(['Nature'])).toContain('nature');
  });

  test('"Weather" maps to nature', () => {
    expect(mapThemesToTopics(['Weather'])).toContain('nature');
  });

  test('"Death" maps to mortality and grief', () => {
    const result = mapThemesToTopics(['Death']);
    expect(result).toContain('mortality');
    expect(result).toContain('grief');
  });

  test('"Grief" maps to grief', () => {
    expect(mapThemesToTopics(['Grief'])).toContain('grief');
  });

  test('"Romance" maps to love', () => {
    expect(mapThemesToTopics(['Romance'])).toContain('love');
  });

  test('"Love" maps to love', () => {
    expect(mapThemesToTopics(['Love'])).toContain('love');
  });

  test('"Oceans" maps to the-sea', () => {
    expect(mapThemesToTopics(['Oceans'])).toContain('the-sea');
  });

  test('mapping is case-insensitive', () => {
    expect(mapThemesToTopics(['NATURE'])).toContain('nature');
    expect(mapThemesToTopics(['weather'])).toContain('nature');
    expect(mapThemesToTopics(['ROMANCE'])).toContain('love');
  });

  test('unknown theme returns empty array', () => {
    expect(mapThemesToTopics(['PublicDomain'])).toEqual([]);
  });

  test('empty themes returns empty array', () => {
    expect(mapThemesToTopics([])).toEqual([]);
  });

  test('multiple themes are aggregated', () => {
    const result = mapThemesToTopics(['Love', 'Nature']);
    expect(result).toContain('love');
    expect(result).toContain('nature');
  });

  test('duplicate topics from multiple themes are deduplicated', () => {
    // Both "Grief" and "Mourning" map to grief
    const result = mapThemesToTopics(['Grief', 'Mourning']);
    const grieveCount = result.filter((t) => t === 'grief').length;
    expect(grieveCount).toBe(1);
  });

  test('"War" maps to war', () => {
    expect(mapThemesToTopics(['War'])).toContain('war');
  });

  test('"Faith" maps to faith', () => {
    expect(mapThemesToTopics(['Faith'])).toContain('faith');
  });

  test('"Childhood & Coming of Age" maps to childhood and identity', () => {
    const result = mapThemesToTopics(['Childhood & Coming of Age']);
    expect(result).toContain('childhood');
    expect(result).toContain('identity');
  });

  test('"Mythology & Folklore" maps to myth', () => {
    expect(mapThemesToTopics(['Mythology & Folklore'])).toContain('myth');
  });

  test('"Social Commentaries" maps to rebellion', () => {
    expect(mapThemesToTopics(['Social Commentaries'])).toContain('rebellion');
  });
});

// ---------------------------------------------------------------------------
// extractTopicsFromKeywords
// ---------------------------------------------------------------------------

describe('extractTopicsFromKeywords', () => {
  test('finds nature from title with "nature"', () => {
    expect(extractTopicsFromKeywords('Nature Walk', '')).toContain('nature');
  });

  test('finds mortality from content with "death"', () => {
    expect(extractTopicsFromKeywords('', 'The shadows of death crept in')).toContain('mortality');
  });

  test('finds love from content with "love"', () => {
    expect(extractTopicsFromKeywords('', 'My love for you shall never fade')).toContain('love');
  });

  test('finds the-sea from title with "sea"', () => {
    expect(extractTopicsFromKeywords('By the Sea', '')).toContain('the-sea');
  });

  test('finds night from content with "moon"', () => {
    expect(extractTopicsFromKeywords('', 'The moon rose over the hill')).toContain('night');
  });

  test('finds grief from content with "tears"', () => {
    expect(extractTopicsFromKeywords('', 'Tears fell down her cheeks')).toContain('grief');
  });

  test('finds home from title with "home"', () => {
    expect(extractTopicsFromKeywords('Coming Home', '')).toContain('home');
  });

  test('is case-insensitive', () => {
    expect(extractTopicsFromKeywords('THE SEA', '')).toContain('the-sea');
    expect(extractTopicsFromKeywords('', 'DEATH came calling')).toContain('mortality');
  });

  test('returns empty array for text with no keywords', () => {
    const result = extractTopicsFromKeywords('Xyz Abstract', 'qwerty asdf poiuy');
    expect(result).toEqual([]);
  });

  test('combines title and content keywords', () => {
    const result = extractTopicsFromKeywords('Ocean', 'A lover wept');
    expect(result).toContain('the-sea');
    expect(result).toContain('love');
  });
});

// ---------------------------------------------------------------------------
// assignTopics
// ---------------------------------------------------------------------------

describe('assignTopics', () => {
  test('uses theme mapping when themes are available', () => {
    const result = assignTopics(['Nature', 'Love'], 'Title', 'Content');
    expect(result.usedFallback).toBe(false);
    expect(result.topics).toContain('nature');
    expect(result.topics).toContain('love');
  });

  test('falls back to keyword extraction when themes produce no results', () => {
    const result = assignTopics([], 'The Sea', 'Waves crash on the shore');
    expect(result.usedFallback).toBe(true);
    expect(result.topics).toContain('the-sea');
  });

  test('usedFallback is false when themes produce results', () => {
    const result = assignTopics(['Nature'], 'Title', 'Content');
    expect(result.usedFallback).toBe(false);
  });

  test('usedFallback is false when no topics found at all', () => {
    const result = assignTopics([], 'Xyz Abstract', 'qwerty asdf poiuy');
    expect(result.usedFallback).toBe(false);
    expect(result.topics).toEqual([]);
  });

  test('caps topics at MAX_TOPICS (3)', () => {
    // Provide many mappable themes
    const result = assignTopics(
      ['Nature', 'Love', 'Death', 'War', 'Faith', 'Solitude'],
      'Title',
      'Content',
    );
    expect(result.topics.length).toBeLessThanOrEqual(MAX_TOPICS);
  });

  test('returns only canonical topic IDs', () => {
    const result = assignTopics(['Nature', 'Love'], 'Title', 'Content');
    for (const topic of result.topics) {
      expect(CANONICAL_TOPICS).toContain(topic);
    }
  });

  test('deduplicates topics', () => {
    // "Grief" and "Mourning" both map to grief
    const result = assignTopics(['Grief', 'Mourning'], 'Title', 'Content');
    const grieveCount = result.topics.filter((t) => t === 'grief').length;
    expect(grieveCount).toBe(1);
  });

  test('prefers theme mapping over keyword fallback when themes match', () => {
    // Theme says "Nature", content has "death" keyword
    const result = assignTopics(['Nature'], 'Title', 'death and graves everywhere');
    expect(result.usedFallback).toBe(false);
    // Should only have nature from theme mapping (not mortality from keyword)
    expect(result.topics).toContain('nature');
  });
});

// ---------------------------------------------------------------------------
// TagPoemSchema
// ---------------------------------------------------------------------------

describe('TagPoemSchema', () => {
  const baseDedup: DedupPoem = {
    title: 'The Raven',
    author: 'Edgar Allan Poe',
    year: '1845',
    content: 'Once upon a midnight dreary\nWhile I pondered weak and weary',
    themes: ['Death', 'Grief'],
    form: 'trochaic octameter',
    provenances: [
      {
        sourceId: 'abc123',
        source: 'poets.org',
        sourceUrl: 'https://poets.org/poem/raven',
        isPublicDomain: true,
        scrapedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };

  test('validates a correct TagPoem', () => {
    const tagged = { ...baseDedup, topics: ['mortality', 'grief'] };
    const result = TagPoemSchema.safeParse(tagged);
    expect(result.success).toBe(true);
  });

  test('validates a TagPoem with empty topics', () => {
    const tagged = { ...baseDedup, topics: [] };
    const result = TagPoemSchema.safeParse(tagged);
    expect(result.success).toBe(true);
  });

  test('rejects a TagPoem with more than 3 topics', () => {
    const tagged = {
      ...baseDedup,
      topics: ['nature', 'mortality', 'love', 'grief'],
    };
    const result = TagPoemSchema.safeParse(tagged);
    expect(result.success).toBe(false);
  });

  test('rejects a TagPoem with an invalid topic ID', () => {
    const tagged = { ...baseDedup, topics: ['not-a-real-topic'] };
    const result = TagPoemSchema.safeParse(tagged);
    expect(result.success).toBe(false);
  });

  test('rejects a TagPoem missing the topics field', () => {
    const result = TagPoemSchema.safeParse(baseDedup);
    expect(result.success).toBe(false);
  });
});
