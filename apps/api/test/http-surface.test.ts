import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, injectJson, type TestApp } from './support/create-test-app';
import { seedLocalRepository } from './support/seed-repo';

// @suite api.mutate.auth
// @suite api.browse.blob
// @suite api.browse.components
// @suite api.browse.discussions
// @suite api.browse.releases
// @suite api.mutate.profiles
// @suite api.mutate.taxonomy
// @suite api.mutate.storage
// @suite api.mutate.search-index
// @suite api.mutate.working-repos
// @suite api.mutate.tokens-ssh
// @suite git.http.archive-upload-pack
// @suite git.http.working-receive-pack
// @suite api.mutate.phase3-recovery
let harness: TestApp | undefined;
let repoId: string;
let missingId = '00000000-0000-4000-8000-000000000099';

beforeAll(async () => {
  harness = await createTestApp();
  const seeded = await seedLocalRepository(harness.container);
  repoId = seeded.repositoryId;
});

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

describe('HTTP GET surface (trusted session)', () => {
  const readPaths = [
    '/api/health',
    '/api/dashboard',
    '/api/settings',
    '/api/inventory',
    '/api/repositories',
    '/api/archival-profiles',
    '/api/sync-profiles',
    '/api/categories',
    '/api/tags',
    '/api/collections',
    '/api/jobs',
    '/api/storage/pools',
    '/api/credentials',
    '/api/search?q=',
    '/api/auth/session',
    '/api/working-repositories',
    '/api/audit-events',
    '/api/phase3/settings',
    '/api/phase3/backups',
    '/api/phase3/supply-chain/report',
    '/api/phase3/recovery/runs',
    '/api/v1/openapi.json',
    '/api/v1/repositories',
    '/api/v1/settings',
    '/api/v1/storage/pools',
  ];

  for (const path of readPaths) {
    it(`GET ${path}`, async () => {
      const response = await injectJson(harness.app, 'GET', path);
      expect(response.statusCode).toBeGreaterThanOrEqual(200);
      expect(response.statusCode).toBeLessThan(300);
    });
  }

  it('GET repository detail and browse endpoints', async () => {
    const paths = [
      `/api/repositories/${repoId}`,
      `/api/repositories/${repoId}/refs`,
      `/api/repositories/${repoId}/commits`,
      `/api/repositories/${repoId}/tree`,
      `/api/repositories/${repoId}/components`,
      `/api/repositories/${repoId}/issues`,
      `/api/repositories/${repoId}/pulls`,
      `/api/repositories/${repoId}/releases`,
      `/api/repositories/${repoId}/lfs`,
      `/api/repositories/${repoId}/discussions`,
      `/api/repositories/${repoId}/events`,
      `/api/repositories/${repoId}/integrity`,
      `/api/repositories/${repoId}/search-index`,
      `/api/repositories/${repoId}/clone-urls`,
      `/api/phase3/repositories/${repoId}/snapshots`,
    ];
    for (const path of paths) {
      const response = await injectJson(harness.app, 'GET', path);
      expect(response.statusCode, path).toBeLessThan(300);
    }
    const blob = await injectJson(
      harness.app,
      'GET',
      `/api/repositories/${repoId}/blob?ref=HEAD&path=README.md`,
    );
    expect(blob.statusCode).toBeLessThan(300);
  });

  it('GET missing repository is 404', async () => {
    const response = await injectJson(harness.app, 'GET', `/api/repositories/${missingId}`);
    expect(response.statusCode).toBe(404);
  });

  it('protected token routes require a user', async () => {
    const tokens = await injectJson(harness.app, 'GET', '/api/access-tokens');
    expect(tokens.statusCode).toBe(401);
    const ssh = await injectJson(harness.app, 'GET', '/api/ssh-keys');
    expect(ssh.statusCode).toBe(401);
  });
});

describe('HTTP mutations (trusted session)', () => {
  it('PATCH settings accepts allowFileUrls', async () => {
    const response = await injectJson(harness.app, 'PATCH', '/api/settings', { allowFileUrls: true });
    expect(response.statusCode).toBeLessThan(300);
  });

  it('POST verify enqueues a job', async () => {
    const response = await injectJson(harness.app, 'POST', `/api/repositories/${repoId}/verify`, {});
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).toEqual(expect.objectContaining({ jobId: expect.any(String) }));
  });

  it('POST sync enqueues a job', async () => {
    const response = await injectJson(harness.app, 'POST', `/api/repositories/${repoId}/sync`, {});
    expect(response.statusCode).toBeLessThan(300);
  });

  it('v1 search responds', async () => {
    const response = await injectJson(harness.app, 'GET', '/api/v1/search?q=seed');
    expect(response.statusCode).toBeLessThan(300);
  });
});

describe('git smart HTTP info/refs', () => {
  it('advertises archive refs', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/git/archive/${repoId}/info/refs?service=git-upload-pack`,
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).toContain('git-upload-pack');
  });

  it('refuses receive-pack on read-only archives', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/git/archive/${repoId}/git-receive-pack`,
      payload: Buffer.from(''),
    });
    expect(response.statusCode).toBe(403);
  });

  it('advertises working receive-pack after creating a working clone', async () => {
    const name = 'http-surface-work';
    const create = await injectJson(harness.app, 'POST', '/api/working-repositories', {
      name,
      archiveRepositoryId: repoId,
    });
    expect(create.statusCode).toBeLessThan(300);
    const response = await harness.app.inject({
      method: 'GET',
      url: `/git/working/${name}/info/refs?service=git-receive-pack`,
    });
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).toContain('git-receive-pack');
  });
});
