import { describe, it, expect } from 'vitest';
import {
  createQueue,
  queueCurrentId,
  queueNextIds,
  queueAdvance,
  queueAppendPage,
  queueNeedsMoreIds,
} from './duelQueue';

describe('createQueue', () => {
  it('creates an empty queue with default state', () => {
    const q = createQueue();
    expect(q.ids).toEqual([]);
    expect(q.currentIndex).toBe(0);
    expect(q.currentPage).toBe(1);
    expect(q.hasMore).toBe(true);
  });
});

describe('queueCurrentId', () => {
  it('returns null for an empty queue', () => {
    expect(queueCurrentId(createQueue())).toBeNull();
  });

  it('returns the id at currentIndex', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c'], false);
    expect(queueCurrentId(q)).toBe('a');
  });

  it('returns the id at the advanced index after advance', () => {
    const q = queueAdvance(queueAppendPage(createQueue(), ['a', 'b'], false));
    expect(queueCurrentId(q)).toBe('b');
  });

  it('returns null when advanced past end of queue', () => {
    const q = queueAdvance(queueAppendPage(createQueue(), ['a'], true));
    expect(queueCurrentId(q)).toBeNull();
  });
});

describe('queueNextIds', () => {
  it('returns empty array when queue has no next ids', () => {
    const q = queueAppendPage(createQueue(), ['a'], false);
    expect(queueNextIds(q, 2)).toEqual([]);
  });

  it('returns up to count next ids after currentIndex', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c', 'd'], false);
    expect(queueNextIds(q, 2)).toEqual(['b', 'c']);
  });

  it('returns remaining ids when fewer than count available', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b'], false);
    expect(queueNextIds(q, 5)).toEqual(['b']);
  });

  it('respects currentIndex when returning next ids', () => {
    const q = queueAdvance(queueAppendPage(createQueue(), ['a', 'b', 'c', 'd'], false));
    expect(queueNextIds(q, 2)).toEqual(['c', 'd']);
  });
});

describe('queueAdvance', () => {
  it('increments currentIndex by 1', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c'], false);
    const advanced = queueAdvance(q);
    expect(advanced.currentIndex).toBe(1);
  });

  it('does not mutate the original state', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b'], false);
    queueAdvance(q);
    expect(q.currentIndex).toBe(0);
  });

  it('advances to correct id', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c'], false);
    expect(queueCurrentId(queueAdvance(q))).toBe('b');
    expect(queueCurrentId(queueAdvance(queueAdvance(q)))).toBe('c');
  });
});

describe('queueAppendPage', () => {
  it('appends ids to an empty queue', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b'], false);
    expect(q.ids).toEqual(['a', 'b']);
  });

  it('appends ids to a queue that already has ids', () => {
    const q1 = queueAppendPage(createQueue(), ['a', 'b'], false);
    const q2 = queueAppendPage(q1, ['c', 'd'], true);
    expect(q2.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('increments currentPage', () => {
    const q = queueAppendPage(createQueue(), ['a'], false);
    expect(q.currentPage).toBe(2);
    const q2 = queueAppendPage(q, ['b'], true);
    expect(q2.currentPage).toBe(3);
  });

  it('sets hasMore to false when isLastPage is true', () => {
    const q = queueAppendPage(createQueue(), ['a'], true);
    expect(q.hasMore).toBe(false);
  });

  it('keeps hasMore true when isLastPage is false', () => {
    const q = queueAppendPage(createQueue(), ['a'], false);
    expect(q.hasMore).toBe(true);
  });

  it('does not mutate the original state', () => {
    const q = createQueue();
    queueAppendPage(q, ['a'], false);
    expect(q.ids).toEqual([]);
  });
});

describe('queueNeedsMoreIds', () => {
  it('returns false when hasMore is false (last page already fetched)', () => {
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c'], true);
    expect(queueNeedsMoreIds(q, 2)).toBe(false);
  });

  it('returns false when plenty of ids remain ahead', () => {
    // At index 0 with ['a','b','c','d','e'], remaining=4 > prefetchCount=2
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c', 'd', 'e'], false);
    expect(queueNeedsMoreIds(q, 2)).toBe(false);
  });

  it('returns true when remaining ids are at or below prefetchCount', () => {
    // At index 0 with ['a','b','c'], remaining=2 <= prefetchCount=2
    const q = queueAppendPage(createQueue(), ['a', 'b', 'c'], false);
    expect(queueNeedsMoreIds(q, 2)).toBe(true);
  });

  it('returns true when on the last available id with more available remotely', () => {
    // At index 1 (last) with ['a','b'], remaining=0 <= prefetchCount=1
    const q = queueAdvance(queueAppendPage(createQueue(), ['a', 'b'], false));
    expect(queueNeedsMoreIds(q, 1)).toBe(true);
  });

  it('returns true when queue is empty but hasMore is true', () => {
    const q = createQueue(); // hasMore=true, ids=[], remaining=-1
    expect(queueNeedsMoreIds(q, 2)).toBe(true);
  });
});
