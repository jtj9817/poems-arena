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

  test('Navigation between Foyer, Anthology, and Colophon', async ({ page }) => {
    await page.goto('/');

    // Start at Foyer
    await expect(page.getByText('Daily Challenge')).toBeVisible();

    // Navigate to Anthology
    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();
    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to Colophon
    const colophonLink = page
      .getByRole('link', { name: /Colophon/i })
      .or(page.getByText('Colophon').first());
    await colophonLink.click();
    await page.waitForTimeout(500);

    // Navigate back to Foyer
    const foyerLink = page
      .getByRole('link', { name: /Foyer|Home|Sanctuary/i })
      .or(page.getByText("Classicist's Sanctuary").first());
    await foyerLink.click();
    await expect(page.getByText('Daily Challenge')).toBeVisible({ timeout: 10_000 });
  });
});
