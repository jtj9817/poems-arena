# [BUG] Phase 6 Frontend Integration Review Findings

**Status:** Closed

## Description
During the code review of the Phase 6 Frontend Integration track, a few issues were identified regarding React logic and performance in the Reading Room.

## Findings

### 1. Missing Cleanup in loadInitial useEffect
- **File**: `apps/web/pages/ReadingRoom.tsx` (Lines 78-123)
- **Category**: Logic Correctness
- **Issue**: The `useEffect` that calls `loadInitial()` does not use a cancellation flag or abort controller. If `duelId` changes quickly before the network request resolves, it can cause race conditions where an older request resolves later and overwrites the state.
- **Recommended Fix**:
  Introduce a boolean `isCurrent` flag inside the `useEffect` and check it before setting state, similar to how it is handled in `Anthology.tsx`.

### 2. Missing Key Prop on Scrollable Container
- **File**: `apps/web/pages/ReadingRoom.tsx` (Line 214)
- **Category**: Logic Correctness / Performance
- **Issue**: The scrollable container `div` inside `SwipeContainer` lacks a `key` prop tied to the `duel.id`. When navigating to the "Next Duel", React updates the DOM nodes in place, meaning the scroll position from the previous duel is incorrectly preserved.
- **Recommended Fix**:
  Add `key={duel.id}` to the `div` immediately inside `SwipeContainer` so that React forces a remount and resets the scroll position to the top.

---

## Resolution

**Closed:** 2026-03-14

Both findings verified as resolved in `apps/web/pages/TheRing.tsx` (the component formerly referenced as `ReadingRoom.tsx`):

1. **Missing useEffect cleanup** — `loadInitial` uses a `let isCurrent = true` cancellation flag; all `setState` calls are guarded by `if (!isCurrent) return;`; the cleanup function returns `() => { isCurrent = false; }`.
2. **Missing key prop** — The `div` immediately inside `SwipeContainer` carries `key={duel.id}`, forcing React to remount the scroll container on duel navigation and reset scroll position to the top.
