import { test, expect } from '@playwright/test';

test.describe('Foyer page', () => {
  test('page loads with heading and Enter Reading Room button', async ({ page }) => {
    await page.goto('/');

    // Main heading should be visible
    await expect(page.getByText('Can you distinguish the soul from the synthesis?')).toBeVisible();

    // Enter Reading Room button should be present
    const enterButton = page.getByRole('button', { name: /Enter Reading Room/i });
    await expect(enterButton).toBeVisible();
  });

  test('displays Daily Challenge label', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Daily Challenge')).toBeVisible();
  });
});
