import { mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db';
import { SettingsService } from '../src/services/settings';
import { StorageService } from '../src/services/storage';

// @suite api.unit.storage-paths
describe('storage path candidates', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('lists data directory children and skips app', () => {
    root = path.join(os.tmpdir(), `fonds-paths-${Date.now()}`);
    const dataDir = path.join(root, 'data');
    mkdirSync(path.join(dataDir, 'app'), { recursive: true });
    mkdirSync(path.join(dataDir, 'pool-2', 'archives'), { recursive: true });
    const dbPath = path.join(root, 'catalog.sqlite');
    const sqlite = openDatabase(dbPath);
    const settings = new SettingsService(sqlite);
    const storage = new StorageService(sqlite, settings, () => ({ freeBytes: 1_000, totalBytes: 2_000 }), dataDir);
    const items = storage.pathCandidates();
    const paths = items.map((item) => item.path);
    expect(paths).toContain(path.resolve(dataDir));
    expect(paths).toContain(path.resolve(path.join(dataDir, 'pool-2')));
    expect(paths.some((item) => item.endsWith(`${path.sep}app`))).toBe(false);
    sqlite.close();
  });
});
