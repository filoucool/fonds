import { expect, test } from '@playwright/test';
import { MISSING_REPO_ID, REPO_TABS, TOP_LEVEL_ROUTES } from '../fixtures/routes';

// @suite ui.navigation.top-level
test.describe('top-level routes', () => {
  for (const route of TOP_LEVEL_ROUTES) {
    test(`${route.path} shows ${route.heading}`, async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading, level: 1 })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    });
  }
});

// @suite ui.navigation.not-found
test('unknown path shows not found', async ({ page }) => {
  await page.goto('/this-route-does-not-exist');
  await expect(page.getByText('Not found', { exact: true })).toBeVisible();
});

// @suite ui.navigation.repo-tabs
test.describe('repository tab routes', () => {
  for (const tab of REPO_TABS) {
    test(`/repositories/:id/${tab} loads shell when repo is missing`, async ({ page }) => {
      await page.goto(`/repositories/${MISSING_REPO_ID}/${tab}`);
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
      await expect(page.getByText(/repository not found/i)).toBeVisible();
    });
  }
});

// @suite ui.navigation.job-detail
test('job detail route loads when job is missing', async ({ page }) => {
  await page.goto(`/jobs/${MISSING_REPO_ID}`);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job', level: 1 })).toBeVisible();
});
