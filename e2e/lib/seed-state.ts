import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SEED_STATE_PATH = path.join(__dirname, '../fixtures/seed-state.json');

export interface SeedState {
  repositoryId: string;
  displayName: string;
  jobId: string;
  originPath: string;
}

export function writeSeedState(state: SeedState): void {
  writeFileSync(SEED_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function readSeedState(): SeedState {
  const raw = readFileSync(SEED_STATE_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isSeedState(parsed)) {
    throw new Error('seed-state.json is missing or invalid; run the setup project first');
  }
  return parsed;
}

function isSeedState(value: unknown): value is SeedState {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.repositoryId === 'string' &&
    typeof row.displayName === 'string' &&
    typeof row.jobId === 'string' &&
    typeof row.originPath === 'string'
  );
}
