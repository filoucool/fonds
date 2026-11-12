import { expect, test } from '@playwright/test';
import { installSeedFixture, seed } from '../fixtures/seed-fixture';

installSeedFixture();

// @suite api.mutate.v1
test.describe('v1 API mutations', () => {
  test('POST verify on seeded repository', async ({ request }) => {
    const { repositoryId } = seed();
    const response = await request.post(`/api/v1/repositories/${repositoryId}/verify`);
    expect(response.status()).toBeLessThan(300);
    const body: unknown = await response.json();
    expect(body).toEqual(expect.objectContaining({ jobId: expect.any(String) }));
  });
});
