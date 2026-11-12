import { expect, test } from '@playwright/test';

// @suite ui.flow.storage-pool
test.describe('storage and inventory pages', () => {
  test('storage shows default pool and add form', async ({ page }) => {
    await page.goto('/storage');
    await expect(page.getByRole('heading', { name: 'Storage', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add pool', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.locator('article.panel, .pool-grid article').first()).toBeVisible({ timeout: 10_000 });
  });

  test('inventory renders host JSON document', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory', level: 1 })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('pre.code-view')).toBeVisible({ timeout: 10_000 });
    const text = await page.locator('pre.code-view').textContent();
    expect(text ?? '').toContain('{');
  });
});
