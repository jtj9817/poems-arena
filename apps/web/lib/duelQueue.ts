/**
 * Pure utility functions for the sliding-window duel queue used by ReadingRoom.
 * All functions are immutable — they return a new state object without mutating input.
 */

export interface DuelQueueState {
  /** Ordered list of duel IDs fetched from GET /duels. */
  ids: string[];
  /** Index of the duel currently displayed to the user. */
  currentIndex: number;
  /** Next page number to fetch from GET /duels when more IDs are needed. */
  currentPage: number;
  /** False once GET /duels returns a page smaller than the expected page size. */
  hasMore: boolean;
}

/** Create a fresh empty queue (call once on ReadingRoom mount). */
export function createQueue(): DuelQueueState {
  return { ids: [], currentIndex: 0, currentPage: 1, hasMore: true };
}

/** ID of the duel currently displayed. Returns null if the queue is empty. */
export function queueCurrentId(state: DuelQueueState): string | null {
  return state.ids[state.currentIndex] ?? null;
}

/**
 * IDs of the next `count` duels after the current one.
 * Used to drive pre-fetching: call getDuel(id) for each returned ID.
 */
export function queueNextIds(state: DuelQueueState, count: number): string[] {
  return state.ids.slice(state.currentIndex + 1, state.currentIndex + 1 + count);
}

/** Advance to the next duel in the queue. Does not mutate the original state. */
export function queueAdvance(state: DuelQueueState): DuelQueueState {
  return { ...state, currentIndex: state.currentIndex + 1 };
}

/**
 * Append a new page of duel IDs and advance the page counter.
 * `isLastPage` should be true when the API returned fewer IDs than a full page,
 * indicating there are no more pages to fetch.
 */
export function queueAppendPage(
  state: DuelQueueState,
  newIds: string[],
  isLastPage: boolean,
): DuelQueueState {
  return {
    ...state,
    ids: [...state.ids, ...newIds],
    currentPage: state.currentPage + 1,
    hasMore: !isLastPage,
  };
}

/**
 * Returns true when the queue is running low and another page should be fetched.
 * "Low" means the number of IDs remaining after the current position is ≤ prefetchCount.
 * Always returns false once `hasMore` is false (all pages already fetched).
 */
export function queueNeedsMoreIds(state: DuelQueueState, prefetchCount: number): boolean {
  if (!state.hasMore) return false;
  const remaining = state.ids.length - state.currentIndex - 1;
  return remaining <= prefetchCount;
}
