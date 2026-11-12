import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite ui.shell.global-search
// @suite ui.shell.nav-complete
test.describe('shell with seeded archive', () => {
  test('primary nav lists every console section', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const label of [
      'Dashboard',
      'Repositories',
      'Search',
      'Import',
      'Jobs',
      'Storage',
      'Preservation',
      'Settings',
    ]) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByText('API responding', { exact: true })).toBeVisible();
  });

  test('global search bar finds the seeded repository', async ({ page }) => {
    const { displayName } = seed();
    await page.goto('/dashboard');
    const search = page.getByRole('search');
    await search.getByPlaceholder('Search metadata, paths…').fill(displayName);
    await search.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByRole('link', { name: displayName })).toBeVisible({ timeout: 10_000 });
  });

  test('brand link returns to dashboard from repository', async ({ page }) => {
    const { repositoryId } = seed();
    await page.goto(`/repositories/${repositoryId}/overview`);
    await page.getByRole('link', { name: 'Fonds' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  });
});
