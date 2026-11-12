import { expect, test } from '@playwright/test';

// @suite ui.flow.search-index
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

test.describe('search page with seeded metadata', () => {
  test('metadata search returns the seeded repository', async ({ page }) => {
    const { displayName } = seed();
    await page.goto('/search');
    await page.getByPlaceholder('Repository name, path, or source text').fill(displayName);
    await page.locator('form.filters').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: displayName })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Index on disk')).toBeVisible();
  });
});
