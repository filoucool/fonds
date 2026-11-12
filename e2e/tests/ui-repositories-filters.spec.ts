import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite ui.repositories.filters
test.describe('repositories list UI', () => {
  test('filter form and import action', async ({ page }) => {
    await page.goto('/repositories');
    await expect(page.locator('main').getByRole('link', { name: 'Import' })).toBeVisible();
    await expect(page.getByPlaceholder('Name or URL')).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Sort')).toBeVisible();
  });

  test('search by name narrows to the seeded repository', async ({ page }) => {
    const { displayName } = seed();
    await page.goto('/repositories');
    await page.getByPlaceholder('Name or URL').fill(displayName);
    await page.locator('form.filters').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: displayName })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('status filter healthy shows seeded repo', async ({ page }) => {
    const { displayName } = seed();
    await page.goto('/repositories?status=healthy');
    await expect(page.getByRole('link', { name: displayName })).toBeVisible({ timeout: 10_000 });
  });

  test('row opens overview tab', async ({ page }) => {
    const { displayName, repositoryId } = seed();
    await page.goto('/repositories');
    await page.getByRole('link', { name: displayName }).click();
    await expect(page).toHaveURL(new RegExp(`/repositories/${repositoryId}/overview`));
    await expect(page.getByRole('heading', { name: displayName, level: 1 })).toBeVisible();
  });
});
