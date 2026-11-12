import { expect, test } from '@playwright/test';

// @suite ui.flow.preservation-backup
test.describe('preservation page controls', () => {
  test('backup path input and snapshot toggle', async ({ page }) => {
    await page.goto('/preservation');
    await expect(page.getByRole('heading', { name: 'Preservation', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backups', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Snapshots', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Queue local backup' })).toBeVisible();
    await expect(page.getByText('Local backup directory')).toBeVisible();
  });
});
