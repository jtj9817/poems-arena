import { describe, expect, test } from 'bun:test';
import { generateSourceId } from './hashing';

describe('generateSourceId', () => {
  test('produces deterministic output for same (source, url, title) triple', () => {
    const id1 = generateSourceId('gutenberg', 'https://example.com/poem', 'The Rhodora');
    const id2 = generateSourceId('gutenberg', 'https://example.com/poem', 'The Rhodora');
    expect(id1).toBe(id2);
  });

  test('produces different IDs for different sources', () => {
    const id1 = generateSourceId('gutenberg', 'https://example.com/poem', 'The Rhodora');
    const id2 = generateSourceId('loc-180', 'https://example.com/poem', 'The Rhodora');
    expect(id1).not.toBe(id2);
  });

  test('produces different IDs for different urls', () => {
    const id1 = generateSourceId('gutenberg', 'https://example.com/a', 'The Rhodora');
    const id2 = generateSourceId('gutenberg', 'https://example.com/b', 'The Rhodora');
    expect(id1).not.toBe(id2);
  });

  test('produces different IDs for different titles', () => {
    const id1 = generateSourceId('gutenberg', 'https://example.com/poem', 'The Rhodora');
    const id2 = generateSourceId('gutenberg', 'https://example.com/poem', 'The Humble-Bee');
    expect(id1).not.toBe(id2);
  });

  test('returns a non-empty string for minimal inputs', () => {
    const id = generateSourceId('', '', '');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns a non-empty string for single-character inputs', () => {
    const id = generateSourceId('a', 'b', 'c');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('is stable across repeated calls (no randomness)', () => {
    const ids = Array.from({ length: 10 }, () =>
      generateSourceId('poets.org', 'https://poets.org/poem/test', 'Test Poem'),
    );
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
  });

  test('returns hexadecimal string', () => {
    const id = generateSourceId('gutenberg', 'https://example.com/poem', 'The Rhodora');
    expect(id).toMatch(/^[0-9a-f]+$/);
  });
});
