import { test, expect } from '@playwright/test';

test.describe('Reading Room page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Navigate to Reading Room by clicking Enter Reading Room
    const enterButton = page.getByRole('button', { name: /Enter Reading Room/i });
    await enterButton.click();

    // Wait for Reading Room content to load — replaces brittle waitForTimeout
    await expect(page.getByText('Subject')).toBeVisible({ timeout: 15_000 });
  });

  test('displays two poems with Exhibit A and Exhibit B labels', async ({ page }) => {
    // Wait for content to load (duel fetch)
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Exhibit B')).toBeVisible();
  });

  test('displays two Select This Work buttons', async ({ page }) => {
    // Wait for poems to load
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });

    const selectButtons = page.getByRole('button', { name: /Select This Work/i });
    await expect(selectButtons).toHaveCount(2);
  });

  test('voting reveals verdict overlay', async ({ page }) => {
    // Wait for poems to load
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });

    // Click first "Select This Work" button
    const selectButtons = page.getByRole('button', { name: /Select This Work/i });
    await selectButtons.first().click();

    // Wait for verdict overlay
    await expect(page.getByText('The Verdict')).toBeVisible({ timeout: 10_000 });

    // Should show one of the two possible verdict messages
    const verdictText = await page.textContent('body');
    const hasHumanVerdict = verdictText?.includes('You recognized the Human.');
    const hasMachineVerdict = verdictText?.includes('You chose the Machine.');
    expect(hasHumanVerdict || hasMachineVerdict).toBe(true);
  });

  test('verdict overlay has Review Poems and Next Duel buttons', async ({ page }) => {
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });

    // Vote
    const selectButtons = page.getByRole('button', { name: /Select This Work/i });
    await selectButtons.first().click();

    // Wait for verdict
    await expect(page.getByText('The Verdict')).toBeVisible({ timeout: 10_000 });

    // Check for action buttons
    await expect(page.getByRole('button', { name: /Review Poems/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Next Duel/i })).toBeVisible();
  });

  test('verdict overlay exposes data-animation-state="open"', async ({ page }) => {
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });

    // Vote to open the verdict popup
    await page
      .getByRole('button', { name: /Select This Work/i })
      .first()
      .click();
    await expect(page.getByText('The Verdict')).toBeVisible({ timeout: 10_000 });

    // The VerdictPopup backdrop must carry the animation state attribute
    await expect(page.locator('[data-animation-state="open"]')).toBeVisible();
  });

  test('Next Duel loads the next duel and SwipeContainer returns to idle state', async ({
    page,
  }) => {
    await expect(page.getByText('Exhibit A')).toBeVisible({ timeout: 10_000 });
    const duelPanels = page.locator('.prose');
    const initialDuelPanels = await duelPanels.allInnerTexts();
    const swipeContainer = page
      .locator(
        '[data-animation-state="idle"], [data-animation-state="swipe-out"], [data-animation-state="swipe-in"]',
      )
      .first();

    // Vote
    await page
      .getByRole('button', { name: /Select This Work/i })
      .first()
      .click();
    await expect(page.getByText('The Verdict')).toBeVisible({ timeout: 10_000 });

    // Click Next Duel — with reducedMotion animations collapse to end state immediately
    await page.getByRole('button', { name: /Next Duel/i }).click();

    // Verify real progression: either queue is exhausted (Anthology) or duel content changes.
    await expect
      .poll(
        async () => {
          const inAnthology = await page
            .getByRole('heading', { name: 'The Anthology' })
            .isVisible()
            .catch(() => false);
          if (inAnthology) return 'anthology';

          const verdictVisible = await page
            .getByText('The Verdict')
            .isVisible()
            .catch(() => false);
          if (verdictVisible) return null;

          const animationState = await swipeContainer.getAttribute('data-animation-state');
          if (animationState !== 'idle') return null;

          const currentDuelPanels = await duelPanels.allInnerTexts();
          if (currentDuelPanels.length !== initialDuelPanels.length) return null;

          return currentDuelPanels.some(
            (panelText, index) => panelText.trim() !== initialDuelPanels[index]?.trim(),
          )
            ? 'advanced'
            : null;
        },
        { timeout: 10_000 },
      )
      .toMatch(/anthology|advanced/);
  });
});
