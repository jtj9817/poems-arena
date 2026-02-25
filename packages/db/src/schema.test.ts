import { describe, expect, test } from 'bun:test';
import { duels, featuredDuels, poemTopics, poems, scrapeSources, topics, votes } from './schema';

describe('schema', () => {
  test('exports poems table', () => {
    expect(poems).toBeDefined();
  });

  test('exports topics table', () => {
    expect(topics).toBeDefined();
  });

  test('exports poemTopics table', () => {
    expect(poemTopics).toBeDefined();
  });

  test('exports scrapeSources table', () => {
    expect(scrapeSources).toBeDefined();
  });

  test('exports duels table', () => {
    expect(duels).toBeDefined();
  });

  test('exports votes table', () => {
    expect(votes).toBeDefined();
  });

  test('exports featuredDuels table', () => {
    expect(featuredDuels).toBeDefined();
  });
});
