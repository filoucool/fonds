import { expect, test } from '@playwright/test';

// @suite api.get.phase3
test.describe('Phase 3 API', () => {
  test('phase3 settings and supply chain endpoints respond', async ({ request }) => {
    const settings = await request.get('/api/phase3/settings');
    expect(settings.ok()).toBeTruthy();
    const body: unknown = await settings.json();
    expect(body).toEqual(
      expect.objectContaining({
        backups: expect.objectContaining({ enabled: expect.any(Boolean) }),
        snapshots: expect.objectContaining({ onChange: expect.any(Boolean) }),
        dependencies: expect.objectContaining({ requireApproval: expect.any(Boolean) }),
      }),
    );

    const report = await request.get('/api/phase3/supply-chain/report');
    expect(report.ok()).toBeTruthy();
    const reportBody: unknown = await report.json();
    expect(reportBody).toEqual(expect.objectContaining({ enrolled: expect.any(Array), missing: expect.any(Array) }));

    const backups = await request.get('/api/phase3/backups');
    expect(backups.ok()).toBeTruthy();
    const backupBody: unknown = await backups.json();
    expect(backupBody).toEqual(expect.objectContaining({ items: expect.any(Array) }));
  });
});

// @suite ui.preservation.shell
test.describe('Phase 3 UI', () => {
  test('preservation settings page is reachable', async ({ page }) => {
    await page.goto('/preservation');
    await expect(page.getByRole('heading', { name: 'Preservation', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Backups/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Snapshots/i })).toBeVisible();
  });
});
