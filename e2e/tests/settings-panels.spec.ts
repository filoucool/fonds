import { expect, test } from '@playwright/test';
import { SETTINGS_SECTIONS } from '../fixtures/routes';

// @suite ui.settings.panels
test('settings exposes every configuration panel', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();

  for (const section of SETTINGS_SECTIONS) {
    if (typeof section === 'string') {
      await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: section.pattern })).toBeVisible();
    }
  }
});
