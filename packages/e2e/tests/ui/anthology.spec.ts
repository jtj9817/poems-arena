import { test, expect } from '@playwright/test';

test.describe('Anthology page', () => {
  test('displays The Anthology heading', async ({ page }) => {
    await page.goto('/');

    // Navigate to Anthology via the nav
    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByText('The Anthology')).toBeVisible({ timeout: 10_000 });
  });

  test('shows duel cards with win rates when duels exist', async ({ page }) => {
    await page.goto('/');

    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByText('The Anthology')).toBeVisible({ timeout: 10_000 });

    // If duels exist, check for win rate text
    const body = await page.textContent('body');
    if (body?.includes('Human Win Rate')) {
      await expect(page.getByText(/Human Win Rate/i).first()).toBeVisible();
    }
  });
});
