import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import {
  SNAPSHOT_MANIFEST_SCHEMA,
  type ArchiveSnapshotSummary,
  type RetentionPreview,
  type RetentionPreviewItem,
  type SnapshotCause,
  type SnapshotManifestV1,
} from '@fonds/shared';
import { HttpError } from '../errors';
import { asRow, asRows, id, nowIso, text } from '../rows';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';
import type { SettingsService } from './settings';

export class SnapshotService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  list(repositoryId: string): ArchiveSnapshotSummary[] {
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT archive_snapshots.*, repositories.display_name AS repository_name
           FROM archive_snapshots JOIN repositories ON repositories.id = archive_snapshots.repository_id
           WHERE archive_snapshots.repository_id = ?
           ORDER BY archive_snapshots.created_at DESC, archive_snapshots.id DESC`,
        )
        .all(repositoryId),
    );
    return rows.map((row) => this.mapRow(row));
  }

  create(repositoryId: string, cause: SnapshotCause, pinned = false): ArchiveSnapshotSummary {
    const settings = this.settings.get().phase3.snapshots;
    if (cause === 'manual' && !settings.manual) throw new HttpError(400, 'manual snapshots are disabled');
    const repo = this.catalog.require(repositoryId);
    const manifestRow = asRow(this.sqlite.prepare(`SELECT * FROM archive_manifests WHERE repository_id = ?`).get(repositoryId));
    const generation = manifestRow ? Number(manifestRow.generation) : 0;
    const contentHash = manifestRow ? text(manifestRow, 'content_hash') : '';
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const refs = captureRefs(located.paths.gitDir);
    const checksums = existsSync(path.join(located.paths.root, 'checksums.json'))
      ? JSON.parse(readFileSync(path.join(located.paths.root, 'checksums.json'), 'utf8')) as { files?: { path: string; sha256: string; bytes: number }[] }
      : { files: [] };
    const files = Array.isArray(checksums.files) ? checksums.files : [];
    const assets = files.slice(0, 500).map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes }));
    const snapshotId = id();
    const createdAt = nowIso();
    const body: Omit<SnapshotManifestV1, 'contentDigest'> = {
      schemaVersion: SNAPSHOT_MANIFEST_SCHEMA,
      snapshotId,
      repositoryId,
      cause,
      createdAt,
      archiveGeneration: generation,
      archiveContentHash: contentHash,
      refs,
      assets,
    };
    const contentDigest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const manifest: SnapshotManifestV1 = { ...body, contentDigest };
    const rel = path.join('app', 'snapshots', repositoryId, `${snapshotId}.json`);
    const abs = path.join(this.dataDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const archiveJson = path.join(located.paths.root, 'archive.json');
    if (existsSync(archiveJson)) {
      copyFileSync(archiveJson, path.join(this.dataDir, 'app', 'snapshots', repositoryId, `${snapshotId}-archive.json`));
    }
    const pinnedInt = pinned ? 1 : 0;
    this.sqlite
      .prepare(
        `INSERT INTO archive_snapshots (id, repository_id, cause, content_digest, manifest_rel_path, pinned, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(snapshotId, repositoryId, cause, contentDigest, rel, pinnedInt, createdAt);
    return {
      id: snapshotId,
      repositoryId,
      repositoryName: repo.displayName,
      cause,
      contentDigest,
      pinned,
      createdAt,
    };
  }

  maybeOnChange(repositoryId: string, previousHash: string | null, nextHash: string): ArchiveSnapshotSummary | null {
    const settings = this.settings.get().phase3.snapshots;
    if (!settings.onChange) return null;
    if (previousHash !== null && previousHash === nextHash) return null;
    return this.create(repositoryId, 'sync-change');
  }

  getManifest(snapshotId: string): SnapshotManifestV1 {
    const row = asRow(this.sqlite.prepare(`SELECT manifest_rel_path FROM archive_snapshots WHERE id = ?`).get(snapshotId));
    if (!row) throw new HttpError(404, 'snapshot not found');
    const rel = text(row, 'manifest_rel_path');
    const abs = path.join(this.dataDir, rel);
    if (!existsSync(abs)) throw new HttpError(404, 'snapshot manifest is missing on disk');
    const parsed: unknown = JSON.parse(readFileSync(abs, 'utf8'));
    if (!isSnapshotManifest(parsed)) throw new HttpError(500, 'snapshot manifest is invalid');
    return parsed;
  }

  diff(leftId: string, rightId: string): { onlyLeft: string[]; onlyRight: string[]; changed: string[] } {
    const left = this.getManifest(leftId);
    const right = this.getManifest(rightId);
    const leftRefs = new Map(left.refs.map((ref) => [ref.name, ref.oid]));
    const rightRefs = new Map(right.refs.map((ref) => [ref.name, ref.oid]));
    const names = new Set([...leftRefs.keys(), ...rightRefs.keys()]);
    const onlyLeft: string[] = [];
    const onlyRight: string[] = [];
    const changed: string[] = [];
    for (const name of names) {
      const l = leftRefs.get(name);
      const r = rightRefs.get(name);
      if (l && !r) onlyLeft.push(name);
      else if (!l && r) onlyRight.push(name);
      else if (l && r && l !== r) changed.push(name);
    }
    return { onlyLeft, onlyRight, changed };
  }

  setPinned(snapshotId: string, pinned: boolean): void {
    const updated = this.sqlite.prepare(`UPDATE archive_snapshots SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, snapshotId);
    if (updated.changes === 0) throw new HttpError(404, 'snapshot not found');
  }

  retentionPreview(repositoryId: string): RetentionPreview {
    const policy = this.settings.get().phase3.snapshots.retention;
    const rows = this.list(repositoryId);
    return planSnapshotRetention(rows, policy.keepLast, policy.maxAgeDays, policy.protectPinned);
  }

  prune(repositoryId: string, dryRun: boolean, confirmProtected = false): RetentionPreview {
    const preview = this.retentionPreview(repositoryId);
    if (preview.wouldDelete.some((item) => item.protected) && !confirmProtected) {
      throw new HttpError(409, 'retention would delete pinned snapshots; confirm explicitly');
    }
    if (!dryRun) {
      for (const item of preview.wouldDelete) {
        if (item.protected) continue;
        this.sqlite.prepare(`DELETE FROM archive_snapshots WHERE id = ?`).run(item.id);
      }
    }
    return preview;
  }

  private mapRow(row: Record<string, unknown>): ArchiveSnapshotSummary {
    return {
      id: text(row, 'id'),
      repositoryId: text(row, 'repository_id'),
      repositoryName: text(row, 'repository_name'),
      cause: text(row, 'cause') as SnapshotCause,
      contentDigest: text(row, 'content_digest'),
      pinned: Number(row.pinned) === 1,
      createdAt: text(row, 'created_at'),
    };
  }
}

function planSnapshotRetention(
  items: ArchiveSnapshotSummary[],
  keepLast: number | null,
  maxAgeDays: number | null,
  protectPinned: boolean,
): RetentionPreview {
  const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const keep = new Set<string>();
  if (keepLast !== null) {
    for (const snap of sorted.slice(0, keepLast)) keep.add(snap.id);
  } else {
    for (const snap of sorted) keep.add(snap.id);
  }
  const cutoff = maxAgeDays !== null ? new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString() : null;
  const wouldDelete: RetentionPreviewItem[] = [];
  const wouldKeep: RetentionPreviewItem[] = [];
  for (const snap of sorted) {
    const protectedRow = protectPinned && snap.pinned;
    const item: RetentionPreviewItem = {
      id: snap.id,
      label: `${snap.cause} snapshot`,
      createdAt: snap.createdAt,
      byteSize: null,
      protected: protectedRow,
      reason: protectedRow ? 'pinned snapshot' : null,
    };
    const shouldKeep = keep.has(snap.id) && !(cutoff && snap.createdAt < cutoff);
    if (shouldKeep || protectedRow) wouldKeep.push(item);
    else wouldDelete.push(item);
  }
  return { wouldDelete, wouldKeep };
}

function isSnapshotManifest(value: unknown): value is SnapshotManifestV1 {
  return typeof value === 'object' && value !== null && 'snapshotId' in value && 'contentDigest' in value;
}

function captureRefs(gitDir: string): SnapshotManifestV1['refs'] {
  if (!existsSync(gitDir)) return [];
  const output: SnapshotManifestV1['refs'] = [];
  try {
    const lines = execFileSync('git', ['--git-dir', gitDir, 'show-ref', '--head'], { encoding: 'utf8' }).split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const oid = parts[0];
      const name = parts[parts.length - 1];
      if (!oid || !name) continue;
      const kind = name.startsWith('refs/archive/') ? 'archived' : 'current';
      output.push({ name, oid, kind });
    }
  } catch {
    return [];
  }
  return output;
}
