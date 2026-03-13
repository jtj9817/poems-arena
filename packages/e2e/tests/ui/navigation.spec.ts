import { test, expect } from '@playwright/test';

test.describe('Cross-view navigation', () => {
  test('Foyer -> ReadingRoom via Enter Reading Room button', async ({ page }) => {
    await page.goto('/');

    // Verify we're on the Foyer
    await expect(page.getByText('Daily Challenge')).toBeVisible();

    // Navigate to Reading Room
    await page.getByRole('button', { name: /Enter Reading Room/i }).click();

    // Wait for Reading Room content to load
    await expect(page.getByText('Subject')).toBeVisible({ timeout: 10_000 });
  });

  test('Navigation between Foyer, Past Bouts, and About', async ({ page }) => {
    await page.goto('/');

    // Start at Foyer
    await expect(page.getByText('Daily Challenge')).toBeVisible();

    // Navigate to Past Bouts
    await page.getByRole('button', { name: /Past Bouts/i }).click();
    await expect(page.getByRole('heading', { name: 'Past Bouts' })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to About
    await page.getByRole('button', { name: /About/i }).click();
    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible({ timeout: 10_000 });

    // Navigate back to Foyer
    await page.getByRole('button', { name: /Poems Arena/i }).click();
    await expect(page.getByText('Daily Challenge')).toBeVisible({ timeout: 10_000 });
  });
});
