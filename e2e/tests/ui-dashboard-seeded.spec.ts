import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite ui.dashboard.widgets
// @suite ui.dashboard.status
test.describe('dashboard with seeded data', () => {
  test('shows archive status counts and job stats', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archive status', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Jobs', level: 2 })).toBeVisible();
    await expect(page.getByText('No repositories archived yet')).not.toBeVisible();
    const countText = await page
      .locator('.stat')
      .filter({ has: page.locator('text=healthy') })
      .locator('.stat-num')
      .first()
      .textContent();
    const count = Number(countText ?? '0');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('widget toggles are present', async ({ page }) => {
    await page.goto('/dashboard');
    const widgets = page.getByRole('group', { name: 'Widgets' });
    await expect(widgets).toBeVisible();
    await expect(widgets.getByText('Status', { exact: true })).toBeVisible();
    await expect(widgets.getByText('Events', { exact: true })).toBeVisible();
  });

  test('due syncs section renders', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Due syncs', level: 2 })).toBeVisible();
    await expect(page.getByText('No syncs due')).toBeVisible();
  });

  test('links to seeded repository from attention or events when present', async ({ page }) => {
    const { displayName } = seed();
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    const repoLink = page.getByRole('link', { name: displayName });
    if (await repoLink.count()) {
      await expect(repoLink.first()).toBeVisible();
    }
  });
});
