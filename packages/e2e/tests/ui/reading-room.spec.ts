import { test, expect } from '@playwright/test';

test.describe('Reading Room page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Navigate to Reading Room by clicking Enter Reading Room
    const enterButton = page.getByRole('button', { name: /Enter Reading Room/i });
    await enterButton.click();

    // Wait for the reading room to load
    await page.waitForTimeout(1000);
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
});
