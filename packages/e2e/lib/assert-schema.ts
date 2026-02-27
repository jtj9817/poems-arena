import { expect } from '@playwright/test';

export interface TopicShape {
  id: string | null;
  label: string;
}

export interface DuelListItemShape {
  id: string;
  topic: string;
  createdAt: string;
  humanWinRate: number;
  avgReadingTime: string;
}

export interface AnonymousDuelShape {
  id: string;
  topic: string;
  poemA: { id: string; title: string; content: string };
  poemB: { id: string; title: string; content: string };
}

export interface DuelStatsShape {
  humanWinRate: number;
  avgReadingTime: string;
  duel: {
    id: string;
    topic: string;
    poemA: { id: string; title: string; content: string; author: string; type: string };
    poemB: { id: string; title: string; content: string; author: string; type: string };
  };
}

export interface VoteResponseShape {
  success: boolean;
  isHuman: boolean;
}

/**
 * Asserts that an object has the shape of a Topic.
 */
export function assertTopic(obj: unknown): asserts obj is TopicShape {
  const topic = obj as Record<string, unknown>;
  expect(topic.id === null || typeof topic.id === 'string').toBe(true);
  expect(typeof topic.label).toBe('string');
}

/**
 * Asserts that an object has the shape of a DuelListItem.
 */
export function assertDuelListItem(obj: unknown): asserts obj is DuelListItemShape {
  const item = obj as Record<string, unknown>;
  expect(typeof item.id).toBe('string');
  expect(typeof item.topic).toBe('string');
  expect(typeof item.createdAt).toBe('string');
  expect(typeof item.humanWinRate).toBe('number');
  expect(typeof item.avgReadingTime).toBe('string');
}

/**
 * Asserts that an object has the shape of an anonymous duel (no author info).
 */
export function assertAnonymousDuel(obj: unknown): asserts obj is AnonymousDuelShape {
  const duel = obj as Record<string, unknown>;
  expect(typeof duel.id).toBe('string');
  expect(typeof duel.topic).toBe('string');

  const poemA = duel.poemA as Record<string, unknown>;
  expect(typeof poemA.id).toBe('string');
  expect(typeof poemA.title).toBe('string');
  expect(typeof poemA.content).toBe('string');
  // Anonymous duels should NOT have author or type
  expect(poemA).not.toHaveProperty('author');
  expect(poemA).not.toHaveProperty('type');

  const poemB = duel.poemB as Record<string, unknown>;
  expect(typeof poemB.id).toBe('string');
  expect(typeof poemB.title).toBe('string');
  expect(typeof poemB.content).toBe('string');
  expect(poemB).not.toHaveProperty('author');
  expect(poemB).not.toHaveProperty('type');
}

/**
 * Asserts that an object has the shape of a DuelStats response (full reveal).
 */
export function assertDuelStats(obj: unknown): asserts obj is DuelStatsShape {
  const stats = obj as Record<string, unknown>;
  expect(typeof stats.humanWinRate).toBe('number');
  expect(typeof stats.avgReadingTime).toBe('string');

  const duel = stats.duel as Record<string, unknown>;
  expect(typeof duel.id).toBe('string');
  expect(typeof duel.topic).toBe('string');

  const poemA = duel.poemA as Record<string, unknown>;
  expect(typeof poemA.author).toBe('string');
  expect(typeof poemA.type).toBe('string');

  const poemB = duel.poemB as Record<string, unknown>;
  expect(typeof poemB.author).toBe('string');
  expect(typeof poemB.type).toBe('string');
}

/**
 * Asserts that an object has the shape of a VoteResponse.
 */
export function assertVoteResponse(obj: unknown): asserts obj is VoteResponseShape {
  const vote = obj as Record<string, unknown>;
  expect(typeof vote.success).toBe('boolean');
  expect(typeof vote.isHuman).toBe('boolean');
}
