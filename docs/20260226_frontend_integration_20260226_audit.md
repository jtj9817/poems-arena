---
audit_file: 20260226_frontend_integration_20260226_audit.md
project_name: frontend_integration_20260226
last_audited_commit: aac5ce0
last_audit_date: 2026-02-27
total_phases: 3
total_commits: 5
---

# Phase Commit Audit — Frontend Integration (20260226)

Conductor track: `conductor/tracks/frontend_integration_20260226/plan.md`
Audit range: `3891b28..HEAD` (inclusive of `3891b28`)

---

## Quick Summary

### Phase 2: Verdict Pop-Up & Swipe Transitions (2 implementation commits, 2026-02-26)
Delivered the full vote-reveal-transition cycle for the Reading Room. Extracted the Verdict into a self-contained modal, built a CSS-keyframe swipe wrapper, introduced an immutable sliding-window duel queue with 23 unit tests, and wired all three pieces into `ReadingRoom.tsx`. A follow-up fix stabilized queue initialization when entering the Reading Room via a direct duel link, preventing premature exit during swipe/next navigation.

### Phase 4: Regression & Quality Gate (3 implementation commits, 2026-02-27)
Locked in the E2E test suite against the Phase 2–3 frontend additions. Added `data-animation-state` testability hooks to `SwipeContainer` and `VerdictPopup`, set `reducedMotion: 'reduce'` globally in the Playwright config to collapse CSS animations, introduced a new `topics.spec.ts` API test file, expanded `anthology.spec.ts` with 4 topic-filtering UI tests, and hardened `reading-room.spec.ts` (replaced brittle `waitForTimeout` with locator waits; added animation-state and Next Duel progression assertions). Two follow-up fixes tightened the anthology chip-selection locator scope and hardened the verification script's lint gate evaluation.

---

## Phase 2: Verdict Pop-Up & Swipe Transitions

### Overview
- **Commits**: 2 implementation commits (`3891b28`, `5fda1e4`)
- **Lines Changed**: +536 / -90 (combined)
- **Files Affected**: 7 files (5 new, 2 modified)
- **Test Coverage**: 1/2 commits have tests (50%) — fix commit is logic-only, no new test cases needed
- **Migrations**: 0

> **Infrastructure commits (excluded from implementation count):**
> - `093d6e4` — conductor(plan): Mark Phase 2 tasks as complete
> - `198c278` — conductor(checkpoint): Checkpoint end of Phase 2 + verification script (`scripts/verify-phase2-frontend-verdict-swipe.ts`, +666 lines)
> - `6d002c9` — conductor(plan): Mark phase complete

---

### Implementation Commits

**`3891b28`** — feat(web): implement Phase 2 verdict pop-up and swipe transitions
**Impact**: +517 / -89 lines, 6 files

- **New file**: `apps/web/lib/duelQueue.ts`
  - Pure immutable queue state module for sliding-window pre-fetching.
  - `DuelQueueState` interface: `{ ids: string[]; currentIndex: number; currentPage: number; hasMore: boolean }`
  - Exported functions:
    - `createQueue(): DuelQueueState` — factory for fresh empty queue
    - `queueCurrentId(state): string | null` — ID at `currentIndex`, or null if empty
    - `queueNextIds(state, count): string[]` — next N IDs after current, used to drive pre-fetch calls
    - `queueAdvance(state): DuelQueueState` — increments `currentIndex` by 1; immutable
    - `queueAppendPage(state, newIds, isLastPage): DuelQueueState` — merges new page of IDs, bumps `currentPage`, sets `hasMore = false` when last page detected
    - `queueNeedsMoreIds(state, prefetchCount): boolean` — returns true when remaining IDs ahead of cursor ≤ `prefetchCount` and `hasMore` is still true

- **New file**: `apps/web/lib/duelQueue.test.ts`
  - 23 unit tests across 5 `describe` blocks:
    - `createQueue` — initial state shape
    - `queueCurrentId` — null on empty, correct ID at current/advanced index, null past end
    - `queueNextIds` — empty array, up to N IDs, respects currentIndex
    - `queueAdvance` — increments correctly, does not mutate original state
    - `queueAppendPage` — append to empty/non-empty queue, page increment, `hasMore` flag transitions, immutability
    - `queueNeedsMoreIds` — false when `hasMore=false`, false when plenty remain, true at/below threshold, true on empty queue with `hasMore=true`

- **New file**: `apps/web/components/VerdictPopup.tsx`
  - Extracted from inline verdict rendering in `ReadingRoom.tsx` into a focused modal component.
  - Props: `{ isOpen, selectedPoemId, stats: DuelStats | null, onContinue, onReviewPoems }`
  - Conditionally renders when `isOpen=true`; resolves selected poem from `stats.duel.poemA/poemB` by ID comparison.
  - Derives `verdictMessage` from `selectedPoem.type === AuthorType.HUMAN` — "You recognized the Human." / "You chose the Machine."
  - Displays `humanWinRate` and `avgReadingTime` stats row.
  - Actions: "Review Poems" (`variant="ghost"`) and "Next Duel" primary `Button`.
  - Animation: `animate-[verdictIn_0.4s_ease-out_forwards]` on the modal card; backdrop `rgba(44,41,37,0.6)`.

- **New file**: `apps/web/components/SwipeContainer.tsx`
  - Thin CSS-keyframe wrapper that drives duel-to-duel transitions.
  - `SwipePhase` type: `'idle' | 'swipe-out' | 'swipe-in'`
  - Props: `{ children, swipePhase, onSwipeOutComplete, onSwipeInComplete }`
  - Applies inline `animation` style based on phase:
    - `swipe-out` → `swipeOutLeft 0.35s ease-in forwards`
    - `swipe-in` → `swipeInRight 0.35s ease-out forwards`
    - `idle` → no animation style
  - Fires the appropriate completion callback on `onAnimationEnd`.

- **Modified**: `apps/web/index.html`
  - Added global `@keyframes` to the `<style>` block:
    - `swipeOutLeft` — translates X 0 → -100% with fade-out opacity
    - `swipeInRight` — translates X 100% → 0 with fade-in opacity
    - `verdictIn` — scale + fade entrance for the VerdictPopup modal card
    - `fadeIn` — generic opacity 0 → 1 helper

- **Modified**: `apps/web/pages/ReadingRoom.tsx` (major refactor, -89 lines net)
  - Added `queueRef: React.MutableRefObject<DuelQueueState>` — persists queue across async closures.
  - Added `prefetchCacheRef: React.MutableRefObject<Map<string, Duel>>` — in-memory cache of pre-fetched duel data.
  - `swipePhase` state (`SwipePhase`) replaces prior ad-hoc transition booleans.
  - Mount flow:
    1. Fetch first page of duel IDs via `api.getDuels(1)`.
    2. Build initial queue with `queueAppendPage(createQueue(), ids, isLastPage)`.
    3. Pre-fetch next 2 duels (`queueNextIds(queue, 2)`) into `prefetchCacheRef`.
  - Page-fetch loop (`fetchMoreIds`): appends next page to `queueRef.current` when `queueNeedsMoreIds` threshold is crossed.
  - Vote → Verdict flow: `handleVote` → `setVerdictOpen(true)`.
  - Continue (acknowledge) → swipe flow: `handleContinue` → `setSwipePhase('swipe-out')`.
  - `onSwipeOutComplete`: advance queue via `queueAdvance`, swap duel content from `prefetchCacheRef` or fetch live, trigger `setSwipePhase('swipe-in')`.
  - `onSwipeInComplete`: reset to `'idle'`, pre-fetch next 2 upcoming duels.
  - Rendered layout: `<SwipeContainer>` wraps duel content; `<VerdictPopup>` is a sibling overlay.

---

**`5fda1e4`** — fix(pages): stabilize reading room duel queue
**Impact**: +19 / -1 lines, 1 file

- **Modified**: `apps/web/pages/ReadingRoom.tsx`

- **Bug 1 — Stale queue on async page-fetch** (`fetchMoreIds` closure):
  - Previous: `queueAppendPage(queue, newIds, isLastPage)` where `queue` was captured from the outer scope at creation time — stale after any advance.
  - Fix: read `queueRef.current` at call time (`const latestQueue = queueRef.current`) before appending, ensuring the append operates on the live queue state, not a closure-captured snapshot.

- **Bug 2 — Queue uninitialized on direct-link entry**:
  - Previous: when `ReadingRoom` was entered with a specific `duelId` prop (e.g., navigating from Anthology), the `else` branch was absent — only the "no-ID" path initialized the queue. `nextDuel` logic relied on `queueRef.current.ids.length > 0` and would exit early.
  - Fix: added `else` branch that fetches the first page of IDs, locates the requested `duelId` in the result, builds an `initialQueue` with the correct `currentIndex`, and falls back to `[id, ...ids]` if the requested ID is not in the page. Pre-fetches upcoming duels after initialization.

---

### Breaking Changes
None.

### Technical Debt Introduced
None explicitly flagged. Observation: the pre-fetch limit is hardcoded to `2` in `ReadingRoom.tsx` (`queueNextIds(queue, 2)`) — could be extracted to a named constant for clarity.

---

---

## Phase 4: Regression & Quality Gate

### Overview
- **Commits**: 3 implementation commits (`dc1e85c`, `5330c61`, `aac5ce0`)
- **Lines Changed**: +249 / -26 (combined, excluding checkpoint script)
- **Files Affected**: 9 files (1 new, 8 modified)
- **Test Coverage**: 3/3 commits add or harden tests (100%)
- **Migrations**: 0

> **Infrastructure commits (excluded from implementation count):**
> - `57e4d7c` — conductor(plan): Mark Phase 4 tasks complete
> - `871a6cc` — conductor(checkpoint): Checkpoint end of Phase 4 + verification script (`scripts/verify-phase4-frontend-regression.ts`, +659 lines, 14 checks across 4 sections)
> - `a3184be` — conductor(plan): Mark phase complete

---

### Implementation Commits

**`dc1e85c`** — test(e2e): Phase 4 regression & quality gate
**Impact**: +176 / -2 lines, 7 files

- **Modified**: `packages/e2e/playwright.config.ts`
  - Added `reducedMotion: 'reduce'` to the global `use` block.
  - Collapses all CSS keyframe animations to their end state in the Playwright browser, making time-sensitive animation assertions reliable without arbitrary `waitForTimeout` calls.

- **Modified**: `apps/web/components/SwipeContainer.tsx`
  - Added `data-animation-state={swipePhase}` attribute to the wrapper `<div>`.
  - Exposes the current phase (`'idle'`, `'swipe-out'`, `'swipe-in'`) as a DOM attribute so E2E tests can `waitForSelector('[data-animation-state="idle"]')` instead of sleeping.

- **Modified**: `apps/web/components/VerdictPopup.tsx`
  - Added `data-animation-state="open"` to the backdrop `<div>` (rendered only when `isOpen=true`).
  - Gives E2E tests a reliable locator for the popup: `page.locator('[data-animation-state="open"]')`.

- **Modified**: `packages/e2e/lib/assert-schema.ts`
  - Added `TopicShape` interface: `{ id: string | null; label: string }`.
  - Added `assertTopic(obj)` assertion helper — validates `id` is `string | null` and `label` is `string`.

- **New file**: `packages/e2e/tests/api/topics.spec.ts`
  - 4 tests in `Topics API` describe block:
    - `GET /topics returns 200 with an array` — status and type check
    - `GET /topics returns topics with id and label fields` — calls `assertTopic(body[0])`
    - `GET /duels?topic_id filters by topic and returns 200` — fetches first topic with a non-null ID, verifies filtered list is an array; skips gracefully if no such topic exists
    - `GET /duels with unknown topic_id returns empty array` — asserts 200 + `toHaveLength(0)` for a nonexistent ID

- **Modified**: `packages/e2e/tests/ui/anthology.spec.ts`
  - Added 4 new tests alongside the original 2:
    - `topic filter bar shows All chip on desktop` — navigates to Anthology, asserts `getByRole('button', { name: 'All' }).first()` is visible within 5 s
    - `selecting a topic chip updates the active filter label` — waits for non-All chips, clicks the first, asserts the label appears in the active state; skips if no topic chips beyond All
    - `clicking All resets the topic filter` — clicks All chip, asserts Anthology heading still visible (no crash or nav away)
    - *(a fourth test was folded into the fix commit `5330c61` with a stronger assertion)*

- **Modified**: `packages/e2e/tests/ui/reading-room.spec.ts`
  - `test.beforeEach`: replaced `await page.waitForTimeout(1000)` with `await expect(page.getByText('Subject')).toBeVisible({ timeout: 15_000 })` — locator-based wait tied to actual page content.
  - Added 2 new tests:
    - `verdict overlay exposes data-animation-state="open"` — votes, waits for "The Verdict", then asserts `page.locator('[data-animation-state="open"]').isVisible()`.
    - `Next Duel loads the next duel and SwipeContainer returns to idle state` — votes, clicks Next Duel, then asserts using `expect.poll` that the app reaches either Anthology (queue exhausted) or a changed duel panel (queue advanced). *(Strengthened by `5330c61`.)*

---

**`5330c61`** — fix(e2e): prevent false positives in ui specs
**Impact**: +48 / -14 lines, 2 files

- **Modified**: `packages/e2e/tests/ui/anthology.spec.ts`
  - `selecting a topic chip` test: replaced `page.getByRole('button').filter({ hasNotText: /^All$/ })` (which could match header nav buttons) with a scoped locator anchored to the `All` chip's parent container — `allChip.locator('xpath=..')` — ensuring only TopicBar chip buttons are matched.
  - Strengthened the post-click assertion from checking label text visibility to CSS class inspection: `expect(firstTopic).toHaveClass(/bg-ink/)` (active state) and `expect(allChip).not.toHaveClass(/bg-ink/)` (deselected).

- **Modified**: `packages/e2e/tests/ui/reading-room.spec.ts`
  - `Next Duel` test: replaced the simple `or()`-chained locator wait with an `expect.poll` loop that verifies real duel progression. The poll:
    1. Returns `'anthology'` if the Anthology heading is visible (queue exhausted path)
    2. Returns `null` if the Verdict overlay is still showing (not yet dismissed)
    3. Reads `data-animation-state` — returns `null` if not yet `'idle'`
    4. Compares `.prose` panel inner texts against the pre-vote snapshot — returns `'advanced'` if any panel text changed, `null` otherwise
  - Matches against `/anthology|advanced/`, preventing the test from passing on unchanged content.

---

**`aac5ce0`** — fix(scripts): harden phase4 gate checks
**Impact**: +25 / -10 lines, 1 file

- **Modified**: `scripts/verify-phase4-frontend-regression.ts`
  - **C2 lint gate**: replaced the simple `stdout.includes(' error ')` string search with ANSI-stripped structured parsing. Added `stripAnsi()` helper to remove escape codes before matching. Gate now passes only if `exitCode === 0`, or if non-zero exit is provably warning-only (`/\b0\s+errors?,\s*[1-9]\d*\s+warnings?\b/i` matches the summary line). Prevents a non-zero exit with errors from being falsely allowed.
  - **A7 beforeEach check**: broadened regex from literal `waitForTimeout(1000)` to `/\bwaitForTimeout\s*\(/` so any hard timeout call in `beforeEach` fails the gate, not just the specific `1000`ms variant.

---

### Breaking Changes
None.

### Technical Debt Introduced
None. The `waitForTimeout(1500)` inside the `selecting a topic chip` test body (not `beforeEach`) is intentional — it waits for the async topic fetch; flagged as an observation but not tracked as debt since the test is conditional and skips cleanly when no topics are loaded.

---

## File Change Heatmap
Files touched across Phase 2 and Phase 4:

| File | Commits | Notes |
|------|---------|-------|
| `packages/e2e/tests/ui/reading-room.spec.ts` | 2 (`dc1e85c`, `5330c61`) | Locator wait + animation-state + Next Duel poll |
| `packages/e2e/tests/ui/anthology.spec.ts` | 2 (`dc1e85c`, `5330c61`) | Topic filter tests + scoped chip locator fix |
| `apps/web/pages/ReadingRoom.tsx` | 2 (`3891b28`, `5fda1e4`) | Major refactor + bug fix |
| `scripts/verify-phase4-frontend-regression.ts` | 2 (`871a6cc`, `aac5ce0`) | New verification script + gate hardening |
| `apps/web/components/VerdictPopup.tsx` | 2 (`3891b28`, `dc1e85c`) | New component + data-animation-state attr |
| `apps/web/components/SwipeContainer.tsx` | 2 (`3891b28`, `dc1e85c`) | New component + data-animation-state attr |
| `packages/e2e/lib/assert-schema.ts` | 1 (`dc1e85c`) | TopicShape + assertTopic() |
| `packages/e2e/playwright.config.ts` | 1 (`dc1e85c`) | reducedMotion: 'reduce' |
| `packages/e2e/tests/api/topics.spec.ts` | 1 (`dc1e85c`) | New — GET /topics + filter coverage |
| `apps/web/lib/duelQueue.ts` | 1 (`3891b28`) | New module |
| `apps/web/lib/duelQueue.test.ts` | 1 (`3891b28`) | New test file |
| `apps/web/index.html` | 1 (`3891b28`) | Keyframe additions |

---

## Test Coverage

**Phase 2**: 1/2 implementation commits include tests (50%)
- `3891b28` — ✅ 23 unit tests for `duelQueue.ts` pure functions; all 30 web tests pass
- `5fda1e4` — no new tests (fix is a closure-capture correction + missing branch; existing suite covers regression)

**Phase 4**: 3/3 implementation commits harden or add tests (100%)
- `dc1e85c` — ✅ 4 new API E2E tests (`topics.spec.ts`); 4 new UI tests in `anthology.spec.ts`; 2 new UI tests + 1 locator fix in `reading-room.spec.ts`; 2 component testability hooks added
- `5330c61` — ✅ strengthens 2 existing Phase 4 tests (chip locator scope + Next Duel poll assertion)
- `aac5ce0` — ✅ hardens verification script gate logic (lint evaluation + beforeEach regex)

**Overall project (web)**: 33 unit tests passing at Phase 4 close (+3 from `api.test.ts` additions in Phase 3).
**Overall project (api)**: 34 tests passing at Phase 4 close.

---

## Cross-Phase Dependencies

Phase 2 builds on the `ReadingRoom.tsx` base established in Phase 1 (Topic Filtering track).
- Reads `api.getDuels(page)` and `api.getDuel(id)` from `apps/web/lib/api.ts` (unchanged in Phase 2).
- Uses `AuthorType` and `DuelStats` types from `@sanctuary/shared` and `apps/web/lib/api.ts`.
- `VerdictPopup` imports `Button` from `apps/web/components/Button.tsx`.

Phase 4 builds on Phase 2 and Phase 3 components.
- Tests `SwipeContainer` and `VerdictPopup` introduced in Phase 2 via `data-animation-state` attributes added in `dc1e85c`.
- Tests `GET /topics` and `GET /duels?topic_id=` endpoints introduced in Phase 0 and the frontend wiring from Phase 1.
- Tests `GET /duels/:id/stats` source attribution from Phase 3 via the live API section of the verification script.
- `topics.spec.ts` reuses `assertTopic()` from `assert-schema.ts`, which extends the existing Phase 0 schema helpers (`assertDuelListItem`, `assertAnonymousDuel`, `assertDuelStats`).

---

## Rollback Commands

To rollback Phase 4 (all 3 implementation commits):
```bash
git revert aac5ce0^..aac5ce0
git revert 5330c61^..5330c61
git revert dc1e85c^..dc1e85c
```

Or as a range:
```bash
git revert dc1e85c^..aac5ce0
```

To rollback Phase 2 (fix + feat):
```bash
git revert 5fda1e4^..5fda1e4
git revert 3891b28^..3891b28
```

Or as a range:
```bash
git revert 3891b28^..5fda1e4
```

---

## Statistics

- **Implementation commits**: 5 (2 Phase 2, 3 Phase 4)
- **Total lines**: +785 / -116 (Phase 2: +536/-90; Phase 4: +249/-26)
- **New files**: 6 (`duelQueue.ts`, `duelQueue.test.ts`, `VerdictPopup.tsx`, `SwipeContainer.tsx`, `verify-phase2-frontend-verdict-swipe.ts`, `topics.spec.ts`)
- **Modified files**: 8 (`ReadingRoom.tsx`, `index.html`, `SwipeContainer.tsx`, `VerdictPopup.tsx`, `playwright.config.ts`, `assert-schema.ts`, `anthology.spec.ts`, `reading-room.spec.ts`)
- **Unit tests**: 23 new in Phase 2 (duelQueue), 33 total web passing at Phase 4 close
- **E2E tests added**: 6 new (4 API + 2 UI reading-room), 4 expanded (anthology)
- **Migrations**: 0
- **Phases completed in track**: 4 of 5 (Phases 0–4 complete; Phase 5 Documentation pending)
