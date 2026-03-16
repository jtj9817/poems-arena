# Frontend Components

Implemented in `apps/web`. All components follow the "Digital Letterpress" design language: Alabaster/Ink palette, classic serif typography, and vanilla CSS animations. Core voting components (`SwipeContainer`, `VerdictPopup`, `SourceInfo`) were introduced in Phase 6. Topic filtering (`TopicBar`, `BottomSheetFilter`) and seeded duel ordering were added in subsequent tracks.

---

## New Components

### `TopicBar`

**File:** `apps/web/components/TopicBar.tsx`

A horizontally scrollable chip bar for single-select topic filtering on the Past Bouts page. Renders an "All" chip plus one chip per `TopicMeta` entry fetched from `GET /api/v1/topics`.

**Props:**

```typescript
interface TopicBarProps {
  idPrefix?: string;            // Optional DOM ID prefix (defaults to auto-generated)
  topics: TopicMeta[];          // Canonical topics from API
  activeTopicId: string | null; // null = "All" (no filter)
  onSelect: (topicId: string | null) => void;
}
```

**Behavior:**
- Chips are `min-h-[44px]` (WCAG touch target).
- The active chip renders `bg-ink text-paper`; inactive chips use `text-ink/60` with a subtle hover state.
- Horizontal overflow scrolls without a visible scrollbar (`no-scrollbar` utility class).
- Selecting "All" calls `onSelect(null)`.

**Usage:** Rendered in `PastBouts.tsx` at `md` breakpoint and above (`hidden md:block`). On smaller screens, `BottomSheetFilter` is used instead (triggered by a "Filter" button in the sticky mobile header).

---

### `BottomSheetFilter`

**File:** `apps/web/components/BottomSheetFilter.tsx`

A mobile-first bottom sheet that presents the same topic list as `TopicBar` in a full-width panel sliding up from the bottom of the screen. Designed for thumb-reachability on iPhone Safari.

**Props:**

```typescript
interface BottomSheetFilterProps {
  idPrefix?: string;            // Optional DOM ID prefix (defaults to auto-generated)
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

A centered modal overlay revealed after the user votes in The Ring. Displays the verdict, per-poem source attribution, community statistics, and navigation actions.

**Props:**

```typescript
interface VerdictPopupProps {
  isOpen: boolean;
  selectedPoemId: string | null;
  stats: DuelStatsResponse | null;  // From GET /duels/:id/stats
  onContinue: () => void;           // Triggers swipe-out → next duel
  onReviewPoems: () => void;        // Closes popup to review poems
}
```

**Behavior:**
- Renders only when `isOpen=true`; otherwise returns `null`.
- Derives the verdict message by comparing `selectedPoemId` to `stats.duel.poemA.id`:
  - `AuthorType.HUMAN` → "You recognized the Human."
  - `AuthorType.AI` → "You chose the Machine."
- Renders `<SourceInfo>` for both `poemA` and `poemB` side by side in a 2-column grid.
- Displays aggregate statistics from `globalStats` and `topicStats`:
  - **Global recognition bar**: horizontal bar whose width is `stats.globalStats.humanWinRate`%; labeled with the percentage.
  - **Topic recognition bar**: same layout using `stats.topicStats.humanWinRate`%; includes a directional delta indicator (`↑`/`↓`) showing how the topic differs from the global rate (e.g. `"↑ 5% vs global"`).
  - **Average decision time**: displays `stats.globalStats.avgDecisionTime` and `stats.topicStats.avgDecisionTime` with a `—` fallback when either value is `null` (no timing samples yet).
- `avgReadingTime` (word-count estimate) has been **removed** from this component; all time data uses behavioral `avgDecisionTime` from aggregates.
- Entrance animation: `verdictIn` keyframe (scale + fade, 0.4s ease-out) defined in `apps/web/index.html`.
- Backdrop: `rgba(44, 41, 37, 0.6)` — matches the Ink palette at 60% opacity.
- Exposes `data-animation-state="open"` on the backdrop `<div>` for E2E test targeting.
- If the stats fetch fails after vote submission, the popup still opens with `stats = null`. Aggregate sections are hidden but the verdict and source reveal remain accessible.

**Actions:**
- "Review Poems" (`Button variant="ghost"`) — calls `onReviewPoems`, closes the popup.
- "Next Duel" (primary `Button`) — calls `onContinue`, triggering the swipe-out transition.

---

### `SwipeContainer`

**File:** `apps/web/components/SwipeContainer.tsx`

A thin CSS-keyframe wrapper that drives the duel-to-duel swipe transitions in The Ring. Manages three animation phases as a state machine.

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
| `swipe-out` | `swipeOutLeft` (translateX 0→-60px + opacity 1→0) | 0.35s ease-in |
| `swipe-in` | `swipeInRight` (translateX 60px→0 + opacity 0→1) | 0.35s ease-out |

Keyframes are defined in `apps/web/index.html`'s `<style>` block. The intentional use of `60px` (not `100%`) gives a subtle directional nudge rather than a full viewport slide.

**Callbacks:** Fired via `onAnimationEnd`. `TheRing.tsx` uses these to:
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
  idPrefix?: string;             // Optional DOM ID prefix (defaults to auto-generated)
  author: string;
  type: AuthorType;              // 'HUMAN' | 'AI'
  year?: string;
  sourceInfo?: SourceInfo;       // From @sanctuary/shared
}
```

Source URLs are passed through `sanitizeExternalHttpUrl()` (from `@sanctuary/shared`) before rendering as anchor tags. Non-http(s) URLs and malformed values are rendered as plain text.

**Behavior:**

| Field | Human poem | AI poem |
|---|---|---|
| Label | "Human Author" | "AI Author" |
| Author line | "Written by {author}" (seal-red italic) | "Generated by {author}" (binding-blue italic) |
| Year | Shown when `year` is present | Hidden |
| Source link | Linked if `sourceInfo.primary.sourceUrl` exists | Not shown |

`SourceInfo` is rendered inside `VerdictPopup` in a 2-column grid — one instance per poem.

---

## Library Modules

### `session` — Session-Scoped Duel Seed

**File:** `apps/web/lib/session.ts`
**Tests:** `apps/web/lib/session.test.ts`

Provides a stable random integer seed for the current browser session. The seed drives deterministic seeded ordering on `GET /duels` so that Home and TheRing see a consistent but varied duel sequence.

**Exported function:**

```typescript
export function getSessionSeed(): number
```

**Behavior:**
- On first call, reads `sessionStorage['duel-seed']`. If a valid non-negative safe integer is found, it is returned as-is.
- If the key is absent or contains an invalid value, a fresh integer in `[0, 2147483647]` is generated, stored in `sessionStorage`, and returned.
- If `sessionStorage` is unavailable (e.g. private-browsing SecurityError), an in-memory fallback (`inMemorySeed`) is used for the lifetime of the module. This keeps the seed stable across multiple calls within the same JS context even without storage.
- `sessionStorage` persists across same-tab reloads, so the same featured duel appears on reload. A new tab generates a new seed.

---

### `duelQueue` — Sliding-Window Pre-Fetch Queue

**File:** `apps/web/lib/duelQueue.ts`
**Tests:** `apps/web/lib/duelQueue.test.ts` (23 unit tests)

Pure immutable utility module managing the ordered list of duel IDs consumed by `TheRing.tsx`. All functions return a new state object; no mutation.

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
| `createQueue()` | Factory — fresh empty queue for The Ring mount |
| `queueCurrentId(state)` | ID at `currentIndex`; `null` if queue is empty |
| `queueNextIds(state, count)` | Next `count` IDs after current — drives pre-fetch calls |
| `queueAdvance(state)` | Increments `currentIndex` by 1; immutable |
| `queueAppendPage(state, newIds, isLastPage)` | Merges a new page; bumps `currentPage`; sets `hasMore=false` on last page |
| `queueNeedsMoreIds(state, prefetchCount)` | `true` when remaining IDs ≤ `prefetchCount` and `hasMore` is still true |

**Constants in `TheRing.tsx`:**

| Constant | Value | Purpose |
|---|---|---|
| `PAGE_SIZE` | `12` | Threshold for last-page detection (`ids.length < PAGE_SIZE → isLastPage`). This matches the API page size contract. |
| `PREFETCH_COUNT` | `2` | Number of upcoming duels pre-fetched into the in-memory cache while the user reads the current duel. |

**Integration in `TheRing.tsx`:**

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

---

## Page Updates

### `Home.tsx`

- Reads a session-scoped seed from `getSessionSeed()` (stored in `useRef`) and fetches the first page of duels via `api.getDuels(1, undefined, seed)` on mount.
- Displays `duels[0].topicMeta.label` as "Featured Topic" in the landing card.
- Navigates to `TheRing` with the featured duel's ID on "Enter Reading Room".
- The 600ms `setTimeout` before navigation matches the CSS `opacity` exit transition.
- Because the seed lives in `sessionStorage`, a reload in the same tab keeps the same featured duel while a fresh tab can receive a different ordering.

**Cold-start retry flow:**
- On a `503 SERVICE_UNAVAILABLE` response, Home retries up to 4 times using increasing delays (`[500, 900, 1400, 2000]ms`).
- While retrying, the loading spinner rotates through status messages ("Establishing archive connection", "Warming the ring", etc.) and shows a progress-dot indicator with a retry count.
- After exhausting retries, the card shows an error message and a "Retry" button that re-triggers the load cycle.
- Non-503 errors skip retries and surface the error immediately.

### `PastBouts.tsx`

Updated in Phase 6 to support dynamic topic filtering.

- Fetches `GET /topics` once on mount into `topics` state.
- Re-fetches `GET /duels(page=1, topicId, undefined, 'recent')` whenever `activeTopicId` changes. Uses a `isCurrent` flag to discard stale responses from concurrent fetches.
- Duel cards display `duel.topicMeta.label` in the topic chip and in the "On {label}" heading.
- Desktop (`md+`): renders `TopicBar` in a sticky `bg-paper/95 backdrop-blur-sm` header.
- Mobile (`< md`): shows the active topic label and a "Filter" button that opens `BottomSheetFilter`.
- `sort=recent` is required here because the API enforces `seed` for randomized consumers.

---

## Interaction Flow: The Ring

```
Entry (direct link or from Past Bouts)
  ├─ queue initializes with page 1 of duel IDs using the current session seed
  └─ if entering with specific duelId:
       ├─ fetch seeded page 1, locate duelId in results
       └─ set currentIndex to match (or prepend duelId if not found)

Duel Display (via SwipeContainer, phase = 'idle')
  ├─ user reads Exhibit A and Exhibit B (authors hidden)
  └─ readingStartedAtRef is set when fade-in completes (after initial load setTimeout)
       or when swipe-in completes (onSwipeInComplete) — whichever applies

Vote (only when canVote = fadeIn && swipePhase === 'idle' && !showPopup && !hasVoted)
  ├─ readingTimeMs = Math.max(1, Math.floor(Date.now() - readingStartedAtRef.current))
  ├─ POST /votes { duelId, selectedPoemId, readingTimeMs } → VoteResponse { isHuman }
  └─ GET /duels/:id/stats → DuelStatsResponse { humanWinRate, globalStats, topicStats, duel }
  └─ VerdictPopup opens (data-animation-state="open")

Verdict Popup
  ├─ Shows global + topic recognition rate bars from globalStats / topicStats
  ├─ Shows avgDecisionTime labels (falls back to "—" when null)
  ├─ "Review Poems" → closes popup, stays on current duel
  └─ "Next Duel":
        └─ setSwipePhase('swipe-out')
             └─ animation ends → content swap → setSwipePhase('swipe-in')
                  └─ animation ends → setSwipePhase('idle')
                       └─ readingStartedAtRef reset here → ready for next vote
```

**Decision-time guard (`canVote`):** The `canVote` boolean prevents votes from being cast during non-idle UI states (fade-in transition, swipe-in transition, popup open, or already voted). This ensures `readingTimeMs` is always computed against the start of the current duel's interactive window, not a previous duel's timer.

---

## CSS Keyframes

Defined in `apps/web/index.html` `<style>` block. Applied via inline `animation` style by `SwipeContainer` and `VerdictPopup`.

| Keyframe | Used by | Effect |
|---|---|---|
| `swipeOutLeft` | `SwipeContainer` | `translateX(0)→translateX(-60px)` + `opacity 1→0` |
| `swipeInRight` | `SwipeContainer` | `translateX(60px)→translateX(0)` + `opacity 0→1` |
| `verdictIn` | `VerdictPopup` | `translateY(-12px) scale(0.97)→normal` + `opacity 0→1` |
| `fadeIn` | `TheRing` initial load | `opacity 0→1` |

**E2E compatibility:** `packages/e2e/playwright.config.ts` sets `reducedMotion: 'reduce'` globally, collapsing all keyframe animations to their end state so tests can assert final conditions without timing dependencies.

---

## Shared Types Used

From `@sanctuary/shared`:

```typescript
interface TopicMeta {
  id: string | null;   // null when duel has no linked topic row
  label: string;       // Falls back to raw duel topic string when id is null
}

interface SourceProvenance {
  source: string;
  sourceUrl: string;
  scrapedAt: string;
  isPublicDomain: boolean;
}

interface SourceInfo {
  primary: {
    source: string | null;      // from poems.source column; null for AI poems
    sourceUrl: string | null;   // from poems.source_url column; null for AI poems
  };
  provenances: SourceProvenance[];  // scrape_sources rows, sorted by scrapedAt desc
}

// Anonymous shapes — used in GET /duels/:id (no author/type reveal)
interface AnonymousPoem {
  id: string;
  title: string;
  content: string;
}

interface AnonymousDuel {
  id: string;
  topic: string;
  poemA: AnonymousPoem;
  poemB: AnonymousPoem;
}

// Revealed shapes — used in GET /duels/:id/stats after voting
interface RevealedPoem {
  id: string;
  title: string;
  content: string;
  author: string;
  type: AuthorType;
  year?: string | null;
  sourceInfo?: SourceInfo;
}

interface Duel {
  id: string;
  topic: string;
  topicMeta: TopicMeta;
  poemA: RevealedPoem;
  poemB: RevealedPoem;
}

// Minimal topic record (id is always non-null here, unlike TopicMeta)
interface Topic {
  id: string;
  label: string;
}

// Stored client-side to record a user's duel choice
interface DuelResult {
  duelId: string;
  selectedPoemId: string;
  isHuman: boolean;
}
```

`SourceInfo` is an optional field on `RevealedPoem` — populated in the `GET /duels/:id/stats` response only. It is absent from `GET /duels/:id` (anonymous view).

---

## API Client (`apps/web/lib/api.ts`)

Updated to support seeded duel discovery, archive chronology, topic filtering, and stats retrieval:

### `ApiRequestError`

All failed HTTP responses throw an `ApiRequestError` (exported from `api.ts`):

```typescript
class ApiRequestError extends Error {
  status: number;   // HTTP status code
  code?: string;    // Stable error code from the API envelope (e.g. "SERVICE_UNAVAILABLE")
  body?: string;    // Raw response body text
}
```

Callers can check `err.status === 503` to detect cold-start unavailability, or `err.code` to match against API error code constants.

### `api` object

```typescript
const api = {
  getTopics(): Promise<TopicMeta[]>                           // GET /topics
  getDuels(
    page?: number,
    topicId?: string,
    seed?: number,
    sort?: 'recent'
  ): Promise<DuelListItem[]>                                  // GET /duels
  getDuel(id: string): Promise<AnonymousDuel>                // GET /duels/:id
  getDuelStats(id: string): Promise<DuelStatsResponse>       // GET /duels/:id/stats
  vote(payload: VoteRequest): Promise<VoteResponse>          // POST /votes
}
```

`getDuels` contract:

- Home and The Ring pass a required session `seed`.
- Past Bouts passes `sort: 'recent'` instead of a seed.
- `topicId` remains optional in both modes.
- Returned `DuelListItem` rows include `avgDecisionTimeMs` and `avgDecisionTime` (topic-level behavioral averages; both `null` until votes with timing data exist for the topic). The old `avgReadingTime` field has been removed.

`vote` contract (updated):

- `VoteRequest` = `{ duelId: string; selectedPoemId: string; readingTimeMs: number }` — `readingTimeMs` is now required.
- The frontend computes `readingTimeMs` as `Math.max(1, Math.floor(Date.now() - readingStartedAt))`.
- `VoteResponse` = `{ success: boolean; isHuman: boolean }` — unchanged.

`getDuelStats` contract:

- Returns `DuelStatsResponse` with `humanWinRate`, `globalStats`, `topicStats`, and `duel`.
- `globalStats` and `topicStats` are always present (zeroed when no votes exist yet).
- `DuelStatsResponse.duel` is a full `Duel` with per-poem `author`, `type`, `year`, and `sourceInfo`.
