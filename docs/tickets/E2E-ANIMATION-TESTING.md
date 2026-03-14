# E2E-ANIMATION-TESTING

**Status:** PARTIALLY COMPLETE  
**Priority:** Low  
**Created:** 2026-02-26  
**Related Track:** `conductor/tracks/frontend_integration_20260226`

## Verification Update (2026-03-08)

Verified against current frontend and E2E test code:

- Animated components expose `data-animation-state` attributes.
- Playwright config defaults to `reducedMotion: 'reduce'`.
- Existing tests cover the reduced-motion path for the Reading Room flow.

Still open:

- I did not find a dedicated smoke test that runs with animations enabled and verifies the full animation lifecycle.

---

## Summary

The Phase 6 Frontend Integration plan adds swipe-like CSS Keyframe animations for duel transitions and a Verdict pop-up in the Reading Room. E2E tests in `packages/e2e/tests/ui/` need a strategy for asserting animation correctness in Playwright without brittle `waitForTimeout` calls.

## Problem

CSS Keyframe animations are inherently time-based. Standard Playwright assertions (visibility, text content) fire immediately and may not account for animation duration or intermediate states. Testing concerns include:

- **Swipe-out/in transitions** between duels after Verdict acknowledgment.
- **Verdict pop-up** entrance/exit animations.
- **Topic chip** selection state transitions on mobile Bottom Sheet.

## Recommended Approach

1. **Use `data-animation-state` attributes** on animated containers (e.g., `data-animation-state="entering"`, `"idle"`, `"exiting"`). Playwright can `waitForSelector('[data-animation-state="idle"]')` instead of arbitrary timeouts.
2. **Disable animations in CI** via `prefers-reduced-motion: reduce` media query override in Playwright config. This collapses animations to their end state, making assertions reliable.
3. **Dedicated animation smoke test** — One test that runs *with* animations enabled and verifies the `data-animation-state` lifecycle progresses correctly.

## Files Affected

- `packages/e2e/tests/ui/reading-room.spec.ts`
- `packages/e2e/playwright.config.ts` (add `reducedMotion: 'reduce'` to `use` config)
- New animated frontend components: `SwipeContainer.tsx`, `VerdictPopup.tsx`

## Acceptance Criteria

- [x] Animated components emit `data-animation-state` attributes.
- [x] E2E config defaults to `reducedMotion: 'reduce'`.
- [ ] At least one smoke test validates the animation lifecycle with animations enabled.

---

## Verification Note (2026-03-14)

Criteria 1 and 2 confirmed as implemented:
- `SwipeContainer.tsx` emits `data-animation-state={swipePhase}`.
- `VerdictPopup.tsx` emits `data-animation-state="open"`.
- `playwright.config.ts` sets `reducedMotion: 'reduce'` with comment "Collapse CSS animations to their end state for reliable assertions".

Criterion 3 remains unmet — no dedicated smoke test that runs with animations enabled (i.e., overriding `reducedMotion` to `no-preference`) and asserts the `data-animation-state` lifecycle was found in `packages/e2e/tests/`.
