import { describe, expect, test } from 'bun:test';
import { generatePoemId, generateScrapeSourceId } from './id-gen';

// ---------------------------------------------------------------------------
// generatePoemId
// ---------------------------------------------------------------------------

describe('generatePoemId', () => {
  test('returns a hex string of consistent length', () => {
    const id = generatePoemId('The Raven', 'Edgar Allan Poe');
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBe(12);
  });

  test('is deterministic — same input produces the same ID', () => {
    const a = generatePoemId('The Raven', 'Edgar Allan Poe');
    const b = generatePoemId('The Raven', 'Edgar Allan Poe');
    expect(a).toBe(b);
  });

  test('is case-insensitive', () => {
    const upper = generatePoemId('THE RAVEN', 'EDGAR ALLAN POE');
    const lower = generatePoemId('the raven', 'edgar allan poe');
    const mixed = generatePoemId('The Raven', 'Edgar Allan Poe');
    expect(upper).toBe(lower);
    expect(lower).toBe(mixed);
  });

  test('is whitespace-insensitive (trims and collapses)', () => {
    const normal = generatePoemId('The Raven', 'Edgar Allan Poe');
    const padded = generatePoemId('  The   Raven  ', '  Edgar   Allan   Poe  ');
    expect(normal).toBe(padded);
  });

  test('different titles produce different IDs', () => {
    const a = generatePoemId('The Raven', 'Edgar Allan Poe');
    const b = generatePoemId('Annabel Lee', 'Edgar Allan Poe');
    expect(a).not.toBe(b);
  });

  test('different authors produce different IDs', () => {
    const a = generatePoemId('Nature', 'Ralph Waldo Emerson');
    const b = generatePoemId('Nature', 'Emily Dickinson');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// generateScrapeSourceId
// ---------------------------------------------------------------------------

describe('generateScrapeSourceId', () => {
  test('returns a hex string of consistent length', () => {
    const id = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/raven');
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBe(12);
  });

  test('is deterministic — same input produces the same ID', () => {
    const a = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/raven');
    const b = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/raven');
    expect(a).toBe(b);
  });

  test('different poem IDs produce different IDs', () => {
    const a = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/raven');
    const b = generateScrapeSourceId('def456', 'poets.org', 'https://poets.org/poem/raven');
    expect(a).not.toBe(b);
  });

  test('different sources produce different IDs', () => {
    const a = generateScrapeSourceId('abc123', 'poets.org', 'https://example.com/poem');
    const b = generateScrapeSourceId('abc123', 'gutenberg', 'https://example.com/poem');
    expect(a).not.toBe(b);
  });

  test('different URLs produce different IDs', () => {
    const a = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/raven');
    const b = generateScrapeSourceId('abc123', 'poets.org', 'https://poets.org/poem/annabel-lee');
    expect(a).not.toBe(b);
  });
});
