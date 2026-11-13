import { expect, test } from '@playwright/test';

// @suite ui.flow.login
test.describe('login (public route)', () => {
  test('login page is reachable without session', async ({ page, request }) => {
    const session = await request.get('/api/auth/session');
    const body: unknown = await session.json();
    const mode = typeof body === 'object' && body !== null ? (body as { mode?: string }).mode : undefined;
    const authenticated =
      typeof body === 'object' && body !== null && (body as { authenticated?: boolean }).authenticated === true;
    const bootstrapUi = mode === 'trusted' && !authenticated;

    await page.goto('/login');
    if (bootstrapUi) {
      await expect(page.getByRole('heading', { name: 'Create admin account', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create admin' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    }
  });

  test('protected route redirects to login when password auth is required', async ({ page, request }) => {
    const mode = await request.get('/api/auth/session');
    const body: unknown = await mode.json();
    if (typeof body !== 'object' || body === null || (body as { mode?: string }).mode !== 'local') {
      test.skip();
      return;
    }
    await page.goto('/storage');
    await expect(page).toHaveURL(/\/login/);
  });
});
