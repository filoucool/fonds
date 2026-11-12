import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { archivePaths, archiveRelativePath } from '@fonds/archive-format';
import type { AppSettings, StoragePoolView } from '@fonds/shared';
import { HttpError, StorageThresholdError } from '../errors';
import { asRow, asRows, flag, id, integer, nowIso, text } from '../rows';
import type { SettingsService } from './settings';
import { makeGitDirWritable } from './archive-readonly';

export interface SpaceInfo {
  freeBytes: number;
  totalBytes: number;
}

export type SpaceProbe = (directory: string) => SpaceInfo;

export function statfsProbe(directory: string): SpaceInfo {
  const stats = statfsSync(directory);
  return {
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
  };
}

export interface PoolRecord {
  id: string;
  name: string;
  rootPath: string;
  freeSpaceThresholdBytes: number;
  acceptNew: boolean;
  enabled: boolean;
  placementWeight: number;
  createdAt: string;
  updatedAt: string;
}

export class StorageService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly settings: SettingsService,
    private readonly probe: SpaceProbe = statfsProbe,
  ) {}

  list(): StoragePoolView[] {
    return this.pools().map((pool) => this.view(pool));
  }

  get(poolId: string): PoolRecord {
    const pool = this.pools().find((item) => item.id === poolId);
    if (!pool) throw new HttpError(404, 'storage pool not found');
    return pool;
  }

  create(input: { name: string; rootPath: string; freeSpaceThresholdBytes: number; acceptNew: boolean; placementWeight: number }): PoolRecord {
    const rootPath = path.resolve(input.rootPath);
    const poolId = id();
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO storage_pools (id, name, root_path, free_space_threshold_bytes, accept_new, enabled, placement_weight, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(poolId, input.name, rootPath, input.freeSpaceThresholdBytes, input.acceptNew ? 1 : 0, input.placementWeight, now, now);
    return this.get(poolId);
  }

  update(poolId: string, patch: { name?: string; freeSpaceThresholdBytes?: number; acceptNew?: boolean; enabled?: boolean; placementWeight?: number }): PoolRecord {
    const current = this.get(poolId);
    this.sqlite
      .prepare(
        `UPDATE storage_pools
         SET name = ?, free_space_threshold_bytes = ?, accept_new = ?, enabled = ?, placement_weight = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.freeSpaceThresholdBytes ?? current.freeSpaceThresholdBytes,
        (patch.acceptNew ?? current.acceptNew) ? 1 : 0,
        (patch.enabled ?? current.enabled) ? 1 : 0,
        patch.placementWeight ?? current.placementWeight,
        nowIso(),
        poolId,
      );
    return this.get(poolId);
  }

  chooseForNew(): PoolRecord {
    const settings = this.settings.get();
    const eligible = this.pools().filter((pool) => pool.enabled && pool.acceptNew && this.aboveThreshold(pool));
    if (settings.placementMode === 'default-pool' || settings.placementMode === 'manual') {
      const selected = eligible.find((pool) => pool.id === settings.defaultPoolId);
      if (!selected) throw new StorageThresholdError('the default pool cannot accept a new archive');
      return selected;
    }
    const ranked = [...eligible].sort((a, b) => this.probe(b.rootPath).freeBytes - this.probe(a.rootPath).freeBytes);
    const selected = ranked[0];
    if (!selected) throw new StorageThresholdError('no storage pool has enough free space');
    return selected;
  }

  assertSpace(poolId: string): void {
    const pool = this.get(poolId);
    if (!this.aboveThreshold(pool)) throw new StorageThresholdError();
  }

  aboveThreshold(pool: PoolRecord): boolean {
    return this.probe(pool.rootPath).freeBytes > pool.freeSpaceThresholdBytes;
  }

  pathsFor(poolId: string, repositoryId: string) {
    const pool = this.get(poolId);
    return { pool, paths: archivePaths(pool.rootPath, repositoryId), relativePath: archiveRelativePath(repositoryId) };
  }

  async migrate(repositoryId: string, destinationPoolId: string, sourcePoolId: string, relativePath: string): Promise<void> {
    const source = this.get(sourcePoolId);
    const destination = this.get(destinationPoolId);
    if (source.id === destination.id) throw new HttpError(400, 'source and destination pools are the same');
    this.assertSpace(destination.id);
    const from = path.join(source.rootPath, ...relativePath.split('/'));
    const to = path.join(destination.rootPath, ...relativePath.split('/'));
    await stat(from);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: false, force: false });
    const { verifyArchiveTree } = await import('../verify-archive');
    const verification = await verifyArchiveTree(to, path.join(to, 'repository.git'));
    if (!verification.ok) {
      await rm(to, { recursive: true, force: true });
      throw new HttpError(409, 'destination archive failed verification; source was left in place');
    }
    this.sqlite.prepare(`UPDATE repositories SET storage_pool_id = ?, updated_at = ? WHERE id = ?`).run(destination.id, nowIso(), repositoryId);
    makeGitDirWritable(path.join(from, 'repository.git'));
    await rm(from, { recursive: true, force: true });
  }

  planBalance(): { repositoryId: string; fromPoolId: string; toPoolId: string }[] {
    const settings = this.settings.get();
    if (!settings.balancingEnabled) return [];
    const pools = this.pools().filter((pool) => pool.enabled);
    const crowded = pools.filter((pool) => this.usedRatio(pool) >= settings.balanceHighWatermarkRatio);
    const roomy = pools.filter((pool) => this.usedRatio(pool) <= settings.balanceLowWatermarkRatio && pool.acceptNew);
    const destination = roomy.sort((a, b) => this.probe(b.rootPath).freeBytes - this.probe(a.rootPath).freeBytes)[0];
    if (!destination || crowded.length === 0) return [];
    const moves: { repositoryId: string; fromPoolId: string; toPoolId: string }[] = [];
    for (const pool of crowded) {
      if (pool.id === destination.id) continue;
      const rows = asRows(
        this.sqlite
          .prepare(
            `SELECT id FROM repositories WHERE storage_pool_id = ? AND deleted_at IS NULL ORDER BY size_bytes DESC LIMIT 5`,
          )
          .all(pool.id),
      );
      for (const row of rows) {
        if (moves.length >= 5) return moves;
        moves.push({ repositoryId: text(row, 'id'), fromPoolId: pool.id, toPoolId: destination.id });
      }
    }
    return moves;
  }

  private usedRatio(pool: PoolRecord): number {
    const space = this.probe(pool.rootPath);
    if (space.totalBytes <= 0) return 1;
    return (space.totalBytes - space.freeBytes) / space.totalBytes;
  }

  private view(pool: PoolRecord): StoragePoolView {
    const space = this.probe(pool.rootPath);
    const count = asRow(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM repositories WHERE storage_pool_id = ? AND deleted_at IS NULL`).get(pool.id));
    return {
      ...pool,
      freeBytes: space.freeBytes,
      totalBytes: space.totalBytes,
      repositoryCount: count ? integer(count, 'count') : 0,
    };
  }

  private pools(): PoolRecord[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM storage_pools ORDER BY name ASC`).all()).map((row) => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      rootPath: text(row, 'root_path'),
      freeSpaceThresholdBytes: integer(row, 'free_space_threshold_bytes'),
      acceptNew: flag(row, 'accept_new'),
      enabled: flag(row, 'enabled'),
      placementWeight: integer(row, 'placement_weight'),
      createdAt: text(row, 'created_at'),
      updatedAt: text(row, 'updated_at'),
    }));
  }
}

export function placementSettings(settings: AppSettings): AppSettings['placementMode'] {
  return settings.placementMode;
}
