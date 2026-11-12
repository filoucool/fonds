import { expect, test } from '@playwright/test';
import { MISSING_REPO_ID } from '../fixtures/routes';

/** Safe GET endpoints on a fresh trusted-mode install (no mutations). */

// @suite api.get.core
// @suite api.get.settings
// @suite api.get.inventory
// @suite api.get.repositories
// @suite api.get.repositories-id
// @suite api.get.profiles
// @suite api.get.taxonomy
// @suite api.get.jobs
// @suite api.get.storage
// @suite api.get.credentials
test.describe('core API GET surface', () => {
  test('health, dashboard, settings, inventory', async ({ request }) => {
    for (const path of ['/api/health', '/api/dashboard', '/api/settings', '/api/inventory']) {
      const response = await request.get(path);
      expect(response.ok(), `${path} should return 2xx`).toBeTruthy();
    }
  });

  test('repository list and taxonomy', async ({ request }) => {
    for (const path of [
      '/api/repositories',
      '/api/archival-profiles',
      '/api/sync-profiles',
      '/api/categories',
      '/api/tags',
      '/api/collections',
      '/api/jobs',
      '/api/storage/pools',
      '/api/credentials',
    ]) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
      const body: unknown = await response.json();
      expect(body).toEqual(expect.objectContaining({ items: expect.any(Array) }));
    }
  });

  test('missing repository returns 404 JSON', async ({ request }) => {
    const response = await request.get(`/api/repositories/${MISSING_REPO_ID}`);
    expect(response.status()).toBe(404);
  });
});

// @suite api.get.phase2
test.describe('phase2 API GET surface', () => {
  test('auth session and search', async ({ request }) => {
    const session = await request.get('/api/auth/session');
    expect(session.ok()).toBeTruthy();
    const sessionBody: unknown = await session.json();
    expect(sessionBody).toEqual(expect.objectContaining({ mode: expect.any(String) }));

    const search = await request.get('/api/search?q=&capabilities=metadata');
    expect(search.ok()).toBeTruthy();
  });

  test('working repos and audit', async ({ request }) => {
    for (const path of ['/api/working-repositories', '/api/audit-events']) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
    }
  });

  test('access tokens and ssh keys require a signed-in user', async ({ request }) => {
    for (const path of ['/api/access-tokens', '/api/ssh-keys']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(401);
    }
  });
});

// @suite api.get.phase3
test.describe('phase3 API GET surface', () => {
  test('settings, backups, supply chain, recovery', async ({ request }) => {
    const settings = await request.get('/api/phase3/settings');
    expect(settings.ok()).toBeTruthy();

    const backups = await request.get('/api/phase3/backups');
    expect(backups.ok()).toBeTruthy();

    const report = await request.get('/api/phase3/supply-chain/report');
    expect(report.ok()).toBeTruthy();

    const runs = await request.get('/api/phase3/recovery/runs');
    expect(runs.ok()).toBeTruthy();
  });
});

// @suite api.get.v1
test.describe('v1 API GET surface', () => {
  test('openapi and resources', async ({ request }) => {
    const openapi = await request.get('/api/v1/openapi.json');
    expect(openapi.ok()).toBeTruthy();

    for (const path of ['/api/v1/repositories', '/api/v1/search?q=', '/api/v1/storage/pools', '/api/v1/settings']) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
    }
  });
});
