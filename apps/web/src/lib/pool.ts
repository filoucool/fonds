import type { Pool } from '../api/types';

export type PoolHealth = 'healthy' | 'low-space' | 'disabled' | 'closed';

export function poolHealth(pool: Pool): PoolHealth {
  if (!pool.enabled) return 'disabled';
  if (!pool.acceptNew) return 'closed';
  if (pool.freeBytes != null && pool.freeBytes < pool.freeSpaceThresholdBytes) return 'low-space';
  return 'healthy';
}

export function poolHealthLabel(health: PoolHealth): string {
  if (health === 'healthy') return 'Healthy';
  if (health === 'low-space') return 'Low space';
  if (health === 'disabled') return 'Disabled';
  return 'Closed';
}

export function poolUsedBytes(pool: Pool): number {
  const total = pool.totalBytes ?? 0;
  const free = pool.freeBytes ?? 0;
  return Math.max(0, total - free);
}

export function usedPercent(pool: Pool): number {
  const total = pool.totalBytes ?? 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (poolUsedBytes(pool) / total) * 100));
}

export function bytesFromGib(gib: number): number {
  if (!Number.isFinite(gib) || gib < 0) return 0;
  return Math.round(gib * 1024 ** 3);
}

export function bytesToGib(bytes: number): number {
  return bytes / 1024 ** 3;
}

export function formatGibForInput(bytes: number): string {
  const gib = bytesToGib(bytes);
  if (gib >= 100) return String(Math.round(gib));
  if (gib >= 10) return gib.toFixed(1);
  return gib.toFixed(2);
}

export function parseGibInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const gib = Number(trimmed);
  if (!Number.isFinite(gib) || gib < 0) return null;
  return bytesFromGib(gib);
}

export const WEIGHT_PRESETS = [
  { id: '1', label: 'Low', value: 1, hint: 'Prefer other pools when balancing.' },
  { id: '5', label: 'Normal', value: 5, hint: 'Default placement weight.' },
  { id: '10', label: 'High', value: 10, hint: 'Favor this pool for new archives.' },
] as const;

export function weightPresetId(weight: number): string {
  const hit = WEIGHT_PRESETS.find((item) => item.value === weight);
  if (hit) return hit.id;
  if (weight <= 2) return '1';
  if (weight <= 7) return '5';
  return '10';
}

export function healthRank(health: PoolHealth): number {
  if (health === 'low-space') return 0;
  if (health === 'closed') return 1;
  if (health === 'disabled') return 2;
  return 3;
}

export type PoolSort = 'health' | 'name' | 'free';

export function sortPools(pools: Pool[], sort: PoolSort): Pool[] {
  const list = [...pools];
  if (sort === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return list;
  }
  if (sort === 'free') {
    list.sort((a, b) => (b.freeBytes ?? 0) - (a.freeBytes ?? 0));
    return list;
  }
  list.sort((a, b) => {
    const diff = healthRank(poolHealth(a)) - healthRank(poolHealth(b));
    if (diff !== 0) return diff;
    return (a.freeBytes ?? 0) - (b.freeBytes ?? 0);
  });
  return list;
}

export interface FleetStats {
  poolCount: number;
  repositoryCount: number;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  belowThreshold: number;
  disabledCount: number;
}

export function fleetStats(pools: Pool[]): FleetStats {
  let totalBytes = 0;
  let freeBytes = 0;
  let repositoryCount = 0;
  let belowThreshold = 0;
  let disabledCount = 0;
  for (const pool of pools) {
    totalBytes += pool.totalBytes ?? 0;
    freeBytes += pool.freeBytes ?? 0;
    repositoryCount += pool.repositoryCount;
    if (!pool.enabled) disabledCount += 1;
    else if (pool.freeBytes != null && pool.freeBytes < pool.freeSpaceThresholdBytes) belowThreshold += 1;
  }
  return {
    poolCount: pools.length,
    repositoryCount,
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    belowThreshold,
    disabledCount,
  };
}

export function dashboardPoolToPool(row: {
  id: string;
  name: string;
  freeBytes: number;
  totalBytes: number;
  thresholdBytes: number;
  repositoryCount: number;
}): Pool {
  return {
    id: row.id,
    name: row.name,
    rootPath: '',
    freeSpaceThresholdBytes: row.thresholdBytes,
    acceptNew: true,
    enabled: true,
    placementWeight: 1,
    freeBytes: row.freeBytes,
    totalBytes: row.totalBytes,
    repositoryCount: row.repositoryCount,
    createdAt: '',
  };
}

export function capacitySegments(pools: Pool[]): { pool: Pool; share: number }[] {
  const totalUsed = pools.reduce((sum, pool) => sum + poolUsedBytes(pool), 0);
  if (totalUsed <= 0) return pools.map((pool) => ({ pool, share: 100 / Math.max(pools.length, 1) }));
  return pools.map((pool) => ({ pool, share: (poolUsedBytes(pool) / totalUsed) * 100 }));
}
