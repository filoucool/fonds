import { expect, test } from '@playwright/test';

// @suite ui.flow.settings-save
test('dashboard widget preference persists after reload', async ({ page }) => {
  await page.goto('/settings#dashboard');
  const widgets = page.getByRole('group', { name: 'Widgets' });
  const events = widgets.getByText('Events', { exact: true });
  await expect(events).toBeVisible();
  const eventsToggle = widgets.locator('label').filter({ hasText: 'Events' }).getByRole('checkbox');
  const wasChecked = await eventsToggle.isChecked();
  await eventsToggle.setChecked(!wasChecked);
  await page.reload();
  await expect(eventsToggle).toBeChecked({ checked: !wasChecked });
});
