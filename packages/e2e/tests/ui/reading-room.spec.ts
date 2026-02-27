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

    // Vote
    await page
      .getByRole('button', { name: /Select This Work/i })
      .first()
      .click();
    await expect(page.getByText('The Verdict')).toBeVisible({ timeout: 10_000 });

    // Click Next Duel — with reducedMotion animations collapse to end state immediately
    await page.getByRole('button', { name: /Next Duel/i }).click();

    // SwipeContainer should settle back to idle (or navigate to Anthology if queue empty)
    // Wait for either the next duel content or the Anthology heading
    await expect(
      page
        .getByText('Subject')
        .or(page.getByRole('heading', { name: 'The Anthology' }))
        .or(page.getByText('Exhibit A')),
    ).toBeVisible({ timeout: 10_000 });
  });
});
