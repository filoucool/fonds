import { test } from '@playwright/test';
import { readSeedState, type SeedState } from '../lib/seed-state';

let seedState: SeedState | undefined;

/** Call once inside a `test.describe` that runs after the setup project. */
export function installSeedFixture(): void {
  test.beforeAll(() => {
    seedState = readSeedState();
  });
}

export function seed(): SeedState {
  if (!seedState) {
    throw new Error('E2E seed is not loaded; ensure the setup project ran successfully.');
  }
  return seedState;
}
