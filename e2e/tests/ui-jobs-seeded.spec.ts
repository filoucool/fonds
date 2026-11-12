import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite ui.flow.jobs-lifecycle
test.describe('jobs UI with seed import', () => {
  test('lists the archive import job', async ({ page }) => {
    const { jobId, displayName } = seed();
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs', level: 1 })).toBeVisible();
    await expect(page.getByLabel('State')).toBeVisible();
    const jobLink = page.getByRole('link', { name: jobId });
    await expect(jobLink).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: displayName })).toBeVisible();
  });

  test('job detail shows steps', async ({ page }) => {
    const { jobId } = seed();
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('text=completed').first()).toBeVisible({ timeout: 10_000 });
  });

  test('state filter controls query string', async ({ page }) => {
    await page.goto('/jobs');
    await page.getByLabel('State').selectOption('completed');
    await expect(page).toHaveURL(/state=completed/);
  });
});
