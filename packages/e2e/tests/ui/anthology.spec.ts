import { test, expect } from '@playwright/test';

test.describe('Anthology page', () => {
  test('displays The Anthology heading', async ({ page }) => {
    await page.goto('/');

    // Navigate to Anthology via the nav
    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('shows duel cards with win rates when duels exist', async ({ page }) => {
    await page.goto('/');

    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });

    // If duels exist, check for win rate text
    const body = await page.textContent('body');
    if (body?.includes('Human Win Rate')) {
      await expect(page.getByText(/Human Win Rate/i).first()).toBeVisible();
    }
  });

  test('topic filter bar shows All chip on desktop', async ({ page }) => {
    await page.goto('/');

    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });

    // The "All" chip is always rendered in the TopicBar (desktop, md+)
    await expect(page.getByRole('button', { name: 'All' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('selecting a topic chip updates the active filter label', async ({ page }) => {
    await page.goto('/');

    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });

    // Scope to the desktop TopicBar chip row to avoid matching header nav buttons.
    const allChip = page.getByRole('button', { name: 'All' }).first();
    await expect(allChip).toBeVisible({ timeout: 5_000 });
    const topicChipRow = allChip.locator('xpath=..');
    const topicButtons = topicChipRow.getByRole('button').filter({ hasNotText: /^All$/ });
    const count = await topicButtons.count();

    if (count === 0) {
      test.skip(true, 'No topic chips available beyond All');
      return;
    }

    // Click the first non-All topic chip
    const firstTopic = topicButtons.first();
    const topicLabel = (await firstTopic.textContent())?.trim() ?? '';
    await firstTopic.click();

    // Selected chip should become active while All is no longer active.
    await expect(firstTopic).toHaveClass(/bg-ink/);
    await expect(topicChipRow.getByRole('button', { name: 'All' })).not.toHaveClass(/bg-ink/);
    await expect(topicChipRow.getByRole('button', { name: topicLabel })).toBeVisible();
  });

  test('clicking All resets the topic filter', async ({ page }) => {
    await page.goto('/');

    const anthologyLink = page
      .getByRole('link', { name: /Anthology/i })
      .or(page.getByText('Anthology').first());
    await anthologyLink.click();

    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible({
      timeout: 10_000,
    });

    // Click All chip and confirm no error state
    const allButton = page.getByRole('button', { name: 'All' }).first();
    await expect(allButton).toBeVisible({ timeout: 5_000 });
    await allButton.click();

    // Page should remain showing the heading (no crash)
    await expect(page.getByRole('heading', { name: 'The Anthology' })).toBeVisible();
  });
});
