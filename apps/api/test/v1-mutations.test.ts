import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, injectJson, type TestApp } from './support/create-test-app';
import { seedLocalRepository } from './support/seed-repo';

// @suite integration.v1.mutations
let harness: TestApp | undefined;
let repoId: string;

beforeAll(async () => {
  harness = await createTestApp();
  repoId = (await seedLocalRepository(harness.container)).repositoryId;
});

afterAll(async () => {
  if (!harness) return;
  const dataDir = harness.config.dataDir;
  await harness.close();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('v1 POST mutations (trusted session)', () => {
  it('POST verify returns a job id', async () => {
    if (!harness) throw new Error('harness missing');
    const response = await injectJson(harness.app, 'POST', `/api/v1/repositories/${repoId}/verify`);
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).toEqual(expect.objectContaining({ jobId: expect.any(String) }));
  });

  it('POST sync returns a job id', async () => {
    if (!harness) throw new Error('harness missing');
    const response = await injectJson(harness.app, 'POST', `/api/v1/repositories/${repoId}/sync`);
    expect(response.statusCode).toBeLessThan(300);
    expect(response.body).toEqual(expect.objectContaining({ jobId: expect.any(String) }));
  });
});
