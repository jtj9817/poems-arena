/**
 * Unit tests for the buildSeedPivot utility.
 *
 * buildSeedPivot hashes a numeric seed with SHA-256 and returns a pivot ID in
 * the format `duel-<12 lowercase hex chars>`, matching the duel ID namespace
 * used in the corpus.
 */
import { describe, expect, test } from 'bun:test';
import { buildSeedPivot } from './seed-pivot';

describe('buildSeedPivot', () => {
  test('output matches duel-<12 lowercase hex chars> format', () => {
    expect(buildSeedPivot(42)).toMatch(/^duel-[0-9a-f]{12}$/);
  });

  test('seed 0 produces a valid pivot', () => {
    expect(buildSeedPivot(0)).toMatch(/^duel-[0-9a-f]{12}$/);
  });

  test('is deterministic: same seed always returns the same pivot', () => {
    expect(buildSeedPivot(42)).toBe(buildSeedPivot(42));
    expect(buildSeedPivot(0)).toBe(buildSeedPivot(0));
    expect(buildSeedPivot(99999)).toBe(buildSeedPivot(99999));
  });

  test('different seeds produce different pivots', () => {
    expect(buildSeedPivot(1)).not.toBe(buildSeedPivot(2));
    expect(buildSeedPivot(0)).not.toBe(buildSeedPivot(1000000));
  });

  test('rejects unsafe integer seeds', () => {
    expect(() => buildSeedPivot(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      'Seed must be a non-negative safe integer',
    );
  });

  test('pivot prefix is exactly "duel-"', () => {
    const pivot = buildSeedPivot(7);
    expect(pivot.startsWith('duel-')).toBe(true);
  });

  test('pivot hex segment is exactly 12 characters', () => {
    const pivot = buildSeedPivot(123);
    const hexPart = pivot.slice('duel-'.length);
    expect(hexPart).toHaveLength(12);
  });
});
