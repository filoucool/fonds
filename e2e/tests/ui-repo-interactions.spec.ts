import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite ui.flow.export-dialog
// @suite ui.flow.repo-overview-actions
test.describe('repository overview interactions', () => {
  test('identity panel shows canonical URL and save action', async ({ page }) => {
    const { repositoryId, displayName } = seed();
    await page.goto(`/repositories/${repositoryId}/overview`);
    await expect(page.getByRole('heading', { name: 'Identity', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue(displayName);
    await expect(page.getByRole('button', { name: 'Save identity' })).toBeVisible();
    await expect(page.getByText('Canonical URL')).toBeVisible();
  });

  test('export dialog opens and can be cancelled', async ({ page }) => {
    const { repositoryId } = seed();
    await page.goto(`/repositories/${repositoryId}/overview`);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Export archive' })).toBeVisible();
    await expect(page.getByText('Bundle', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Export archive' })).not.toBeVisible();
  });

  test('verify queues a job with confirmation in the UI', async ({ page }) => {
    const { repositoryId } = seed();
    await page.goto(`/repositories/${repositoryId}/overview`);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText(/verify queued/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /Job / })).toBeVisible();
  });
});

// @suite ui.repo.with-data.files
test.describe('repository files browser', () => {
  test('opens README blob preview', async ({ page }) => {
    const { repositoryId } = seed();
    await page.goto(`/repositories/${repositoryId}/files`);
    await page.getByRole('button', { name: 'README.md' }).click();
    await expect(page).toHaveURL(/view=blob/);
    await expect(page.getByText('E2E fixture')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'Download raw' })).toBeVisible();
  });
});
