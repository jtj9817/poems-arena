# Frontend Components — Phase 6 Integration

Implemented in `apps/web` as part of the Phase 6 Frontend Integration track. All components follow the "Digital Letterpress" design language: Alabaster/Ink palette, classic serif typography, and vanilla CSS animations.

---

## New Components

### `TopicBar`

**File:** `apps/web/components/TopicBar.tsx`

A horizontally scrollable chip bar for single-select topic filtering on the Anthology page. Renders an "All" chip plus one chip per `TopicMeta` entry fetched from `GET /api/v1/topics`.

**Props:**

```typescript
interface TopicBarProps {
  topics: TopicMeta[];        // Canonical topics from API
  activeTopicId: string | null; // null = "All" (no filter)
  onSelect: (topicId: string | null) => void;
}
```

**Behavior:**
- Chips are `min-h-[44px]` (WCAG touch target).
- The active chip renders `bg-ink text-paper`; inactive chips use `text-ink/60` with a subtle hover state.
- Horizontal overflow scrolls without a visible scrollbar (`no-scrollbar` utility class).
- Selecting "All" calls `onSelect(null)`.

**Usage:** Rendered in `Anthology.tsx` on desktop screens. On mobile, `BottomSheetFilter` is used instead.

---

### `BottomSheetFilter`

**File:** `apps/web/components/BottomSheetFilter.tsx`

A mobile-first bottom sheet that presents the same topic list as `TopicBar` in a full-width panel sliding up from the bottom of the screen. Designed for thumb-reachability on iPhone Safari.

**Props:**

```typescript
interface BottomSheetFilterProps {
  topics: TopicMeta[];
  activeTopicId: string | null;
  onSelect: (topicId: string | null) => void;
  isOpen: boolean;
  onClose: () => void;
}
```

**Behavior:**
- Sheet slides in/out via `translateY` CSS transitions (`300ms cubic-bezier(0.32, 0.72, 0, 1)`).
- Backdrop fades in at `rgba(0,0,0,0.4)` with a separate 250ms opacity transition.
- Respects iOS safe area insets via `env(safe-area-inset-bottom, 16px)`.
- Selecting a topic calls `onSelect(topicId)` then `onClose()` automatically.
- Sheet dismisses when the backdrop is tapped.
- No external animation library — uses vanilla CSS inline styles.

---

### `VerdictPopup`

**File:** `apps/web/components/VerdictPopup.tsx`

A centered modal overlay revealed after the user votes in the Reading Room. Displays the verdict, per-poem source attribution, community statistics, and navigation actions.

**Props:**

```typescript
interface VerdictPopupProps {
  isOpen: boolean;
  selectedPoemId: string | null;
  stats: DuelStats | null;       // From GET /duels/:id/stats
  onContinue: () => void;        // Triggers swipe-out → next duel
  onReviewPoems: () => void;     // Closes popup to review poems
}
```

**Behavior:**
- Renders only when `isOpen=true`; otherwise returns `null`.
- Derives the verdict message by comparing `selectedPoemId` to `stats.duel.poemA.id`:
  - `AuthorType.HUMAN` → "You recognized the Human."
  - `AuthorType.AI` → "You chose the Machine."
- Renders `<SourceInfo>` for both `poemA` and `poemB` side by side in a 2-column grid.
- Displays `humanWinRate` and `avgReadingTime` from the stats payload.
- Entrance animation: `verdictIn` keyframe (scale + fade, 0.4s ease-out) defined in `apps/web/index.html`.
- Backdrop: `rgba(44, 41, 37, 0.6)` — matches the Ink palette at 60% opacity.
- Exposes `data-animation-state="open"` on the backdrop `<div>` for E2E test targeting.

**Actions:**
- "Review Poems" (`Button variant="ghost"`) — calls `onReviewPoems`, closes the popup.
- "Next Duel" (primary `Button`) — calls `onContinue`, triggering the swipe-out transition.

---

### `SwipeContainer`

**File:** `apps/web/components/SwipeContainer.tsx`

A thin CSS-keyframe wrapper that drives the duel-to-duel swipe transitions in the Reading Room. Manages three animation phases as a state machine.

**Types:**

```typescript
export type SwipePhase = 'idle' | 'swipe-out' | 'swipe-in';
```

**Props:**

```typescript
interface SwipeContainerProps {
  children: React.ReactNode;
  swipePhase: SwipePhase;
  onSwipeOutComplete: () => void;  // Called when swipe-out animation ends
  onSwipeInComplete: () => void;   // Called when swipe-in animation ends
}
```

**Animation mapping:**

| `swipePhase` | CSS Animation | Duration |
|---|---|---|
| `idle` | none | — |
| `swipe-out` | `swipeOutLeft` (translate X 0→-100%, fade out) | 0.35s ease-in |
| `swipe-in` | `swipeInRight` (translate X 100%→0, fade in) | 0.35s ease-out |

Keyframes are defined in `apps/web/index.html`'s `<style>` block.

**Callbacks:** Fired via `onAnimationEnd`. `ReadingRoom.tsx` uses these to:
1. `onSwipeOutComplete` → swap duel content from the pre-fetch cache, then trigger `swipe-in`.
2. `onSwipeInComplete` → reset to `idle`, pre-fetch the next upcoming duels.

**Testability:** Exposes `data-animation-state={swipePhase}` on the wrapper `<div>`, allowing E2E tests to `waitForSelector('[data-animation-state="idle"]')` instead of using arbitrary timeouts.

---

### `SourceInfo`

**File:** `apps/web/components/SourceInfo.tsx`

Renders per-poem provenance after the Verdict is revealed. Adapts display based on `AuthorType`.

**Props:**

```typescript
interface SourceInfoProps {
  author: string;
  type: AuthorType;              // 'HUMAN' | 'AI'
  year?: string;
  sourceInfo?: SourceInfo;       // From @sanctuary/shared
}
```

**Behavior:**

| Field | Human poem | AI poem |
|---|---|---|
| Label | "Human Author" | "AI Author" |
| Author line | "Written by {author}" (seal-red italic) | "Generated by {author}" (binding-blue italic) |
| Year | Shown when `year` is present | Hidden |
| Source link | Linked if `sourceInfo.primary.sourceUrl` exists | Not shown |

`SourceInfo` is rendered inside `VerdictPopup` in a 2-column grid — one instance per poem.

---

## New Library Module

### `duelQueue` — Sliding-Window Pre-Fetch Queue

**File:** `apps/web/lib/duelQueue.ts`
**Tests:** `apps/web/lib/duelQueue.test.ts` (23 unit tests)

Pure immutable utility module managing the ordered list of duel IDs consumed by `ReadingRoom.tsx`. All functions return a new state object; no mutation.

**State shape:**

```typescript
interface DuelQueueState {
  ids: string[];          // Ordered duel IDs from GET /duels
  currentIndex: number;   // Index of the currently displayed duel
  currentPage: number;    // Next page to fetch from GET /duels
  hasMore: boolean;       // False once API returns a partial page
}
```

**Exported functions:**

| Function | Description |
|---|---|
| `createQueue()` | Factory — fresh empty queue for ReadingRoom mount |
| `queueCurrentId(state)` | ID at `currentIndex`; `null` if queue is empty |
| `queueNextIds(state, count)` | Next `count` IDs after current — drives pre-fetch calls |
| `queueAdvance(state)` | Increments `currentIndex` by 1; immutable |
| `queueAppendPage(state, newIds, isLastPage)` | Merges a new page; bumps `currentPage`; sets `hasMore=false` on last page |
| `queueNeedsMoreIds(state, prefetchCount)` | `true` when remaining IDs ≤ `prefetchCount` and `hasMore` is still true |

**Integration in `ReadingRoom.tsx`:**

```
Mount
 └─ fetch GET /duels page 1
 └─ queueAppendPage(createQueue(), ids, isLastPage) → queueRef.current
 └─ getDuel for queueNextIds(queue, 2) → prefetchCacheRef (pre-warm)

User votes → VerdictPopup opens

User clicks "Next Duel"
 └─ setSwipePhase('swipe-out')
 └─ onSwipeOutComplete:
     └─ queueAdvance(queueRef.current) → queueRef.current
     └─ load next duel from prefetchCacheRef (or live fetch)
     └─ setSwipePhase('swipe-in')
 └─ onSwipeInComplete:
     └─ setSwipePhase('idle')
     └─ pre-fetch queueNextIds(queue, 2) into cache
     └─ if queueNeedsMoreIds → fetchMoreIds (next page)
```

---

## Interaction Flow: Reading Room

```
Entry (direct link or from Anthology)
  ├─ queue initializes with page 1 of duel IDs
  └─ if entering with specific duelId:
       ├─ fetch page 1, locate duelId in results
       └─ set currentIndex to match (or prepend duelId if not found)

Duel Display (via SwipeContainer, phase = 'idle')
  └─ user reads Exhibit A and Exhibit B (authors hidden)

Vote
  └─ POST /votes → VoteResponse { isHuman }
  └─ GET /duels/:id/stats → DuelStats
  └─ VerdictPopup opens (data-animation-state="open")

Verdict Popup
  ├─ "Review Poems" → closes popup, stays on current duel
  └─ "Next Duel":
        └─ setSwipePhase('swipe-out')
             └─ animation ends → content swap → setSwipePhase('swipe-in')
                  └─ animation ends → setSwipePhase('idle') → ready for next vote
```

---

## CSS Keyframes

Defined in `apps/web/index.html` `<style>` block. Applied via inline `animation` style by `SwipeContainer` and `VerdictPopup`.

| Keyframe | Used by | Effect |
|---|---|---|
| `swipeOutLeft` | `SwipeContainer` | Translates X 0→-100% + fades out |
| `swipeInRight` | `SwipeContainer` | Translates X 100%→0 + fades in |
| `verdictIn` | `VerdictPopup` | Scale + fade entrance for the modal card |
| `fadeIn` | General | Opacity 0→1 helper |

**E2E compatibility:** `packages/e2e/playwright.config.ts` sets `reducedMotion: 'reduce'` globally, collapsing all keyframe animations to their end state so tests can assert final conditions without timing dependencies.

---

## Shared Types Used

From `@sanctuary/shared`:

```typescript
interface TopicMeta {
  id: string | null;
  label: string;
}

interface SourceInfo {
  primary: {
    source: string;
    sourceUrl: string | null;
  };
  provenances: Array<{
    source: string;
    sourceUrl: string | null;
    scrapedAt: string;
  }>;
}
```

`SourceInfo` is an optional field on `Poem` — populated in the `GET /duels/:id/stats` response only.

---

## API Client (`apps/web/lib/api.ts`)

Updated in Phase 6 to support topic filtering and stats retrieval:

```typescript
const api = {
  getTopics(): Promise<TopicMeta[]>                           // GET /topics
  getDuels(page?: number, topicId?: string): Promise<DuelListItem[]>  // GET /duels[?topic_id=]
  getDuel(id: string): Promise<AnonymousDuel>                // GET /duels/:id
  getDuelStats(id: string): Promise<DuelStats>               // GET /duels/:id/stats
  vote(duelId, selectedPoemId): Promise<VoteResponse>        // POST /votes
}
```

`DuelListItem` includes `topicMeta: TopicMeta` for Anthology card display. `DuelStats.duel` is a full `Duel` with per-poem `author`, `type`, `year`, and `sourceInfo`.
