import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, injectJson, type TestApp } from './support/create-test-app';

// @suite api.mutate.auth
async function withTrustedApp(run: (harness: TestApp) => Promise<void>): Promise<void> {
  const harness = await createTestApp();
  try {
    await run(harness);
  } finally {
    const dataDir = harness.config.dataDir;
    await harness.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('auth settings validation (trusted mode)', () => {
  it('rejects switching to local auth before any user exists', async () => {
    await withTrustedApp(async (harness) => {
      const response = await injectJson(harness.app, 'PATCH', '/api/settings', { auth: { mode: 'local' } });
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({ error: 'create an admin account with POST /api/auth/bootstrap before enabling local auth' }),
      );
    });
  });

  it('rejects oidc auth mode in settings', async () => {
    await withTrustedApp(async (harness) => {
      const response = await injectJson(harness.app, 'PATCH', '/api/settings', { auth: { mode: 'oidc' } });
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(expect.objectContaining({ error: 'oidc is not implemented' }));
    });
  });

  it('rejects auth.bootstrapCompleted in settings patch', async () => {
    await withTrustedApp(async (harness) => {
      const response = await injectJson(harness.app, 'PATCH', '/api/settings', { auth: { bootstrapCompleted: false } });
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({ error: 'auth.bootstrapCompleted cannot be changed through settings' }),
      );
    });
  });
});

describe('local authentication', () => {
  let harness: TestApp | undefined;

  afterAll(async () => {
    if (!harness) return;
    const dataDir = harness.config.dataDir;
    await harness.close();
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('rejects unauthenticated API access after bootstrap', async () => {
    harness = await createTestApp();
    const bootstrap = await injectJson(harness.app, 'POST', '/api/auth/bootstrap', {
      username: 'admin',
      password: 'twelve-char-password',
    });
    expect(bootstrap.statusCode).toBeLessThan(300);

    const dashboard = await injectJson(harness.app, 'GET', '/api/dashboard');
    expect(dashboard.statusCode).toBe(401);
    expect(dashboard.body).toEqual({ error: 'authentication required' });

    const settings = await injectJson(harness.app, 'GET', '/api/settings');
    expect(settings.statusCode).toBe(401);
  });
});
