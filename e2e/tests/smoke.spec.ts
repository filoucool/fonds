import { expect, test } from '@playwright/test';

// @suite api.get.health
// @suite api.get.dashboard
// @suite api.get.phase2
test.describe('API', () => {
  test('health responds', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: true, version: expect.any(String) });
  });

  test('v1 settings and search endpoints respond', async ({ request }) => {
    const settings = await request.get('/api/v1/settings');
    expect(settings.ok()).toBeTruthy();
    const settingsBody: unknown = await settings.json();
    expect(settingsBody).toEqual(expect.objectContaining({ settings: expect.any(Object) }));

    const search = await request.get('/api/search?q=&capabilities=metadata');
    expect(search.ok()).toBeTruthy();
    const searchBody: unknown = await search.json();
    expect(searchBody).toEqual(expect.objectContaining({ items: expect.any(Array), usageBytes: expect.any(Number) }));
  });

  test('dashboard JSON matches UI expectations', async ({ request }) => {
    const response = await request.get('/api/dashboard');
    expect(response.ok()).toBeTruthy();
    const body: unknown = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        countsByStatus: expect.any(Object),
        jobs: expect.objectContaining({
          queued: expect.any(Number),
          running: expect.any(Number),
        }),
        storage: expect.objectContaining({ pools: expect.any(Array) }),
      }),
    );
  });
});

// @suite ui.shell.nav
// @suite ui.dashboard.data
// @suite ui.search.form
test.describe('UI', () => {
  test('shell loads and primary navigation works', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Archiver' })).toBeVisible();

    await page.getByRole('link', { name: 'Repositories' }).click();
    await expect(page).toHaveURL(/\/repositories/);
    await expect(page.getByRole('heading', { name: 'Repositories', level: 1 })).toBeVisible();

    await page.getByRole('link', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
  });

  test('dashboard renders server-backed data', async ({ page, request }) => {
    const dashboard = await request.get('/api/dashboard');
    expect(dashboard.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.locator('.page-header h1')).toHaveText('Dashboard');
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });

  test('search form talks to the API', async ({ page, request }) => {
    await page.goto('/search');
    await page.getByPlaceholder('Repository name, path, or source text').fill('archiver');
    await page.locator('form.filters').getByRole('button', { name: 'Search' }).click();

    const viaApi = await request.get('/api/search?q=archiver&capabilities=metadata,filenames,source_text');
    expect(viaApi.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
    await expect(page.locator('text=Index on disk')).toBeVisible();
  });

  test('settings access section is reachable', async ({ page }) => {
    await page.goto('/settings#access');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Access, Git/i })).toBeVisible();
  });
});
