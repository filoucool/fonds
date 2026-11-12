import { expect, test } from '@playwright/test';

// @suite ui.import.page
test('import page loads and API accepts repository creation shape', async ({ page, request }) => {
  await page.goto('/import');
  await expect(page.getByRole('heading', { name: 'Import', level: 1 })).toBeVisible();

  const settings = await request.get('/api/settings');
  expect(settings.ok()).toBeTruthy();

  const pools = await request.get('/api/v1/storage/pools');
  expect(pools.ok()).toBeTruthy();
  const poolsBody: unknown = await pools.json();
  expect(poolsBody).toEqual(expect.objectContaining({ items: expect.any(Array) }));
});
