import { test as setup, expect } from '@playwright/test';
import { createSeedGitOrigin, E2E_SEED_DISPLAY_NAME } from '../lib/seed-git-origin';
import { writeSeedState } from '../lib/seed-state';
import { waitForJob } from '../lib/wait-for-job';

// @suite e2e.seed.archive
setup('archive a local git repository for browser tests', async ({ request }, testInfo) => {
  testInfo.setTimeout(180_000);
  const settingsPatch = await request.patch('/api/settings', {
    data: { allowFileUrls: true },
  });
  expect(settingsPatch.ok()).toBeTruthy();

  const { originPath, fileUrl } = createSeedGitOrigin();
  const created = await request.post('/api/repositories', {
    data: {
      url: fileUrl,
      displayName: E2E_SEED_DISPLAY_NAME,
      profileId: 'profile-minimal',
    },
  });
  expect(created.status()).toBe(201);

  const createdBody: unknown = await created.json();
  expect(createdBody).toEqual(
    expect.objectContaining({
      jobId: expect.any(String),
      repository: expect.objectContaining({
        id: expect.any(String),
        displayName: E2E_SEED_DISPLAY_NAME,
      }),
    }),
  );

  const parsed = parseCreateResponse(createdBody);
  await waitForJob(request, parsed.jobId);

  const detail = await request.get(`/api/repositories/${parsed.repositoryId}`);
  expect(detail.ok()).toBeTruthy();
  const detailBody: unknown = await detail.json();
  expect(detailBody).toEqual(
    expect.objectContaining({
      archiveStatus: 'healthy',
      health: expect.not.stringMatching(/corrupt/i),
    }),
  );

  writeSeedState({
    repositoryId: parsed.repositoryId,
    displayName: E2E_SEED_DISPLAY_NAME,
    jobId: parsed.jobId,
    originPath,
  });
});

function parseCreateResponse(body: unknown): { repositoryId: string; jobId: string } {
  if (typeof body !== 'object' || body === null) {
    throw new Error('create repository response was not an object');
  }
  const row = body as Record<string, unknown>;
  if (typeof row.jobId !== 'string') {
    throw new Error('create repository response missing jobId');
  }
  if (typeof row.repository !== 'object' || row.repository === null) {
    throw new Error('create repository response missing repository');
  }
  const repository = row.repository as Record<string, unknown>;
  if (typeof repository.id !== 'string') {
    throw new Error('create repository response missing repository.id');
  }
  return { repositoryId: repository.id, jobId: row.jobId };
}
