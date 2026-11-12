import { expect, test } from '@playwright/test';

// @suite ui.import.form
// @suite ui.flow.import-url
test.describe('import page forms', () => {
  test('single and bulk import panels', async ({ page }) => {
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'One repository', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'URL list', level: 2 })).toBeVisible();
    await expect(page.getByPlaceholder('https://example.com/org/repo.git')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toBeVisible();
    const single = page.locator('form').filter({ has: page.getByRole('heading', { name: 'One repository' }) });
    await expect(single.getByLabel('Archival profile')).toBeVisible();
    await expect(page.getByLabel('URLs')).toBeVisible();
  });
});
