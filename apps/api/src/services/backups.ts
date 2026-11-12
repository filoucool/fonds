import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { finalizeBackupManifest } from '@fonds/archive-format';
import type { BackupManifestV1 } from '@fonds/shared';
import {
  type BackupProfile,
  type BackupRunState,
  type BackupRunSummary,
  type BackupTargetConfig,
  type BackupTargetType,
  type RetentionPreview,
  type RetentionPreviewItem,
} from '@fonds/shared';
import { HttpError } from '../errors';
import { asRow, asRows, id, integerOrNull, nowIso, text, textOrNull } from '../rows';
import type { CatalogService } from './catalog';
import type { JobsService } from './jobs';
import type { NotificationService } from './notifications';
import type { SettingsService } from './settings';
import type { StorageService } from './storage';
import { assertBackupComplete, sha256File, uploadBackupTree, verifyBackupTree, writeCompleteMarker } from './backup-transfer';

export class BackupService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationService,
  ) {}

  list(): BackupRunSummary[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM managed_backups ORDER BY created_at DESC, id DESC LIMIT 200`).all()).map((row) =>
      this.mapRun(row),
    );
  }

  get(runId: string): BackupRunSummary {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM managed_backups WHERE id = ?`).get(runId));
    if (!row) throw new HttpError(404, 'backup run not found');
    return this.mapRun(row);
  }

  enqueue(target: BackupTargetConfig, profile?: BackupProfile): { jobId: string; backupId: string } {
    const backupId = id();
    const settings = this.settings.get().phase3.backups;
    const chosen = profile ?? settings.profile;
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO managed_backups (id, profile, scope_json, target_type, target_json, state, boundary_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
      )
      .run(backupId, chosen, JSON.stringify({ collectionIds: settings.collectionIds }), target.type, JSON.stringify(redactTarget(target)), now, now);
    const jobId = this.jobs.enqueue({ type: 'backup', payload: { backupId, target } });
    return { jobId, backupId };
  }

  async run(backupId: string, target: BackupTargetConfig): Promise<void> {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM managed_backups WHERE id = ?`).get(backupId));
    if (!row) throw new Error('backup run row is missing');
    const profile = text(row, 'profile') as BackupProfile;
    this.sqlite.prepare(`UPDATE managed_backups SET state = 'running' WHERE id = ?`).run(backupId);
  const staging = path.join(this.dataDir, 'app', 'managed-backups', 'staging', backupId);
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    let persistedPath: string | null = null;
    try {
      const boundaryAt = nowIso();
      await this.quiesceJobs();
      const catalogPath = path.join(staging, 'catalog.sqlite');
      await this.sqlite.backup(catalogPath);
      chmodSync(catalogPath, 0o600);
      const catalogSha256 = sha256File(catalogPath);
      const archiveIds = this.selectArchiveIds(profile, JSON.parse(text(row, 'scope_json')) as { collectionIds?: string[] });
      const poolRoots = await this.copyArchives(staging, archiveIds);
      const searchPath = path.join(this.dataDir, 'app', 'search-index.sqlite');
      if (existsSync(searchPath)) {
        cpSync(searchPath, path.join(staging, 'search-index.sqlite'));
      }
      const manifest = finalizeBackupManifest({
        backupId,
        createdAt: boundaryAt,
        boundaryAt,
        profile,
        catalogPath: 'catalog.sqlite',
        catalogSha256,
        archiveIds,
        poolRoots,
        searchIndexIncluded: existsSync(searchPath),
        destination: { type: target.type, redacted: redactTarget(target) },
      });
      writeFileSync(path.join(staging, 'backup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      writeCompleteMarker(staging);
      const remoteName = `backup-${backupId}`;
      await uploadBackupTree(staging, target, remoteName);
      const bytes = directoryBytes(staging);
      const verify = this.settings.get().phase3.backups.verifyAfterUpload
        ? await verifyBackupTree(staging, catalogSha256)
        : { ok: true, detail: 'verification skipped by policy' };
      const state: BackupRunState = verify.ok ? 'verified' : 'completed';
      this.sqlite
        .prepare(
          `UPDATE managed_backups SET state = ?, manifest_path = ?, byte_size = ?, content_digest = ?, boundary_at = ?,
           verified_at = ?, verify_status = ?, finished_at = ?, remote_key = ? WHERE id = ?`,
        )
        .run(
          state,
          path.join(staging, 'backup-manifest.json'),
          bytes,
          manifest.contentDigest,
          boundaryAt,
          verify.ok ? nowIso() : null,
          verify.detail,
          nowIso(),
          remoteName,
          backupId,
        );
      if (!verify.ok) this.notifications.record('backup.verify_failed', { backupId, detail: verify.detail });
      persistedPath = path.join(this.dataDir, 'app', 'managed-backups', 'store', backupId);
      mkdirSync(path.dirname(persistedPath), { recursive: true, mode: 0o700 });
      cpSync(staging, persistedPath, { recursive: true });
      this.sqlite
        .prepare(`UPDATE managed_backups SET manifest_path = ? WHERE id = ?`)
        .run(path.join(persistedPath, 'backup-manifest.json'), backupId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'backup failed';
      this.sqlite.prepare(`UPDATE managed_backups SET state = 'failed', error = ?, finished_at = ? WHERE id = ?`).run(message, nowIso(), backupId);
      this.notifications.record('backup.failed', { backupId, error: message });
      throw error;
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
      void persistedPath;
    }
  }

  retentionPreview(): RetentionPreview {
    const policy = this.settings.get().phase3.backups.retention;
    const runs = this.list().filter((run) => run.state === 'verified' || run.state === 'completed');
    return planRetention(runs, policy.keepLast, policy.maxAgeDays, policy.maxBytes, () => false);
  }

  applyRetention(dryRun: boolean): RetentionPreview {
    const policy = this.settings.get().phase3.backups.retention;
    const runs = this.list().filter((run) => run.state === 'verified' || run.state === 'completed');
    const preview = planRetention(runs, policy.keepLast, policy.maxAgeDays, policy.maxBytes, () => false);
    if (!dryRun) {
      for (const item of preview.wouldDelete) {
        this.sqlite.prepare(`DELETE FROM managed_backups WHERE id = ?`).run(item.id);
      }
    }
    return preview;
  }

  readManifest(backupId: string): BackupManifestV1 {
    const row = asRow(this.sqlite.prepare(`SELECT manifest_path FROM managed_backups WHERE id = ?`).get(backupId));
    if (!row) throw new HttpError(404, 'backup run not found');
    const manifestPath = textOrNull(row, 'manifest_path');
    if (!manifestPath || !existsSync(manifestPath)) throw new HttpError(404, 'backup manifest is not on disk');
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!isManifest(parsed)) throw new HttpError(500, 'backup manifest is invalid');
    return parsed;
  }

  dueScheduledBackups(): string[] {
    const settings = this.settings.get().phase3.backups;
    if (!settings.enabled || !settings.schedule || settings.targets.length === 0) return [];
    // Scheduler enqueues via worker tick; return target ids only when due logic is handled externally.
    return settings.targets.map((target, index) => `scheduled-${index}-${target.type}`);
  }

  private async quiesceJobs(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const running = asRow(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM jobs WHERE state = 'running'`).get());
      const count = running ? Number(running.count) : 0;
      if (count === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('timed out waiting for active jobs before backup boundary');
  }

  private selectArchiveIds(profile: BackupProfile, scope: { collectionIds?: string[] }): string[] {
    if (profile === 'catalog-only') return [];
    if (profile === 'selected-collections') {
      const ids = scope.collectionIds ?? [];
      if (ids.length === 0) return [];
      const rows = asRows(
        this.sqlite.prepare(`SELECT DISTINCT repository_id FROM collection_members WHERE collection_id IN (${ids.map(() => '?').join(',')})`).all(...ids),
      );
      return rows.map((row) => text(row, 'repository_id'));
    }
    return asRows(this.sqlite.prepare(`SELECT id FROM repositories WHERE deleted_at IS NULL`).all()).map((row) => text(row, 'id'));
  }

  private async copyArchives(staging: string, archiveIds: string[]): Promise<BackupManifestV1['poolRoots']> {
    const pools = new Map<string, { poolId: string; relativeRoot: string }>();
    for (const archiveId of archiveIds) {
      let repo;
      try {
        repo = this.catalog.require(archiveId);
      } catch {
        continue;
      }
      const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
      const pool = this.storage.get(repo.storagePoolId);
      const archiveDest = path.join(staging, 'pools', pool.name, repo.relativePath);
      mkdirSync(path.dirname(archiveDest), { recursive: true, mode: 0o700 });
      cpSync(located.paths.root, archiveDest, { recursive: true, dereference: false });
      pools.set(pool.id, { poolId: pool.id, relativeRoot: `pools/${pool.name}` });
    }
    return [...pools.values()].map((entry) => {
      const root = path.join(staging, entry.relativeRoot);
      return { poolId: entry.poolId, relativeRoot: entry.relativeRoot, sha256: digestTree(root) };
    });
  }

  private mapRun(row: Record<string, unknown>): BackupRunSummary {
    return {
      id: text(row, 'id'),
      profile: text(row, 'profile') as BackupProfile,
      targetType: text(row, 'target_type') as BackupTargetType,
      state: text(row, 'state') as BackupRunState,
      byteSize: integerOrNull(row, 'byte_size'),
      contentDigest: textOrNull(row, 'content_digest'),
      boundaryAt: text(row, 'boundary_at'),
      verifiedAt: textOrNull(row, 'verified_at'),
      verifyStatus: textOrNull(row, 'verify_status'),
      error: textOrNull(row, 'error'),
      manifestPath: textOrNull(row, 'manifest_path'),
      createdAt: text(row, 'created_at'),
      finishedAt: textOrNull(row, 'finished_at'),
    };
  }
}

export function redactTarget(target: BackupTargetConfig): Record<string, unknown> {
  if (target.type === 'local') return { type: 'local', path: target.path };
  if (target.type === 'sftp') return { type: 'sftp', host: target.host, port: target.port, username: target.username, remotePath: target.remotePath };
  return {
    type: 's3',
    endpoint: target.endpoint,
    bucket: target.bucket,
    prefix: target.prefix,
    region: target.region,
    accessKeyId: target.accessKeyId,
    forcePathStyle: target.forcePathStyle,
  };
}

function planRetention(
  items: BackupRunSummary[],
  keepLast: number | null,
  maxAgeDays: number | null,
  maxBytes: number | null,
  isProtected: (id: string) => boolean,
): RetentionPreview {
  const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const keep = new Set<string>();
  if (keepLast !== null) {
    for (const run of sorted.slice(0, keepLast)) keep.add(run.id);
  } else {
    for (const run of sorted) keep.add(run.id);
  }
  const cutoff =
    maxAgeDays !== null ? new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString() : null;
  let bytes = 0;
  for (const run of sorted) {
    if (maxBytes !== null && bytes + (run.byteSize ?? 0) > maxBytes && !keep.has(run.id)) continue;
    if (cutoff && run.createdAt < cutoff && !keep.has(run.id)) continue;
    keep.add(run.id);
    bytes += run.byteSize ?? 0;
  }
  const wouldDelete: RetentionPreviewItem[] = [];
  const wouldKeep: RetentionPreviewItem[] = [];
  for (const run of sorted) {
    const protectedRow = isProtected(run.id);
    const item: RetentionPreviewItem = {
      id: run.id,
      label: `${run.profile} @ ${run.createdAt}`,
      createdAt: run.createdAt,
      byteSize: run.byteSize,
      protected: protectedRow,
      reason: protectedRow ? 'retention policy protects this backup' : null,
    };
    if (keep.has(run.id) || protectedRow) wouldKeep.push(item);
    else wouldDelete.push(item);
  }
  return { wouldDelete, wouldKeep };
}

function directoryBytes(root: string): number {
  let total = 0;
  for (const entry of walkFiles(root)) {
    total += statSync(entry).size;
  }
  return total;
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, name.name);
    if (name.isDirectory()) files.push(...walkFiles(full));
    else if (name.isFile()) files.push(full);
  }
  return files;
}

function digestTree(root: string): string {
  const hash = createHash('sha256');
  for (const file of walkFiles(root).sort()) {
    hash.update(file.replace(root, ''));
    hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function isManifest(value: unknown): value is BackupManifestV1 {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value && 'backupId' in value;
}
