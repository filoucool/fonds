import { createHash } from 'node:crypto';
import { BACKUP_MANIFEST_SCHEMA, type BackupManifestV1 } from '@repo-archive/shared';
import { isRecord, parseJson } from '@repo-archive/shared';

export function digestBackupManifest(manifest: Omit<BackupManifestV1, 'contentDigest'>): string {
  const body = JSON.stringify({ ...manifest, contentDigest: undefined });
  return createHash('sha256').update(body).digest('hex');
}

export function finalizeBackupManifest(manifest: Omit<BackupManifestV1, 'contentDigest' | 'schemaVersion'>): BackupManifestV1 {
  const draft = { ...manifest, schemaVersion: BACKUP_MANIFEST_SCHEMA };
  return { ...draft, contentDigest: digestBackupManifest(draft) };
}

export function parseBackupManifest(text: string): BackupManifestV1 {
  const parsed = parseJson(text);
  if (!isBackupManifest(parsed)) throw new Error('backup manifest is invalid');
  const expected = digestBackupManifest(parsed);
  if (parsed.contentDigest !== expected) throw new Error('backup manifest digest mismatch');
  return parsed;
}

function isBackupManifest(value: unknown): value is BackupManifestV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== BACKUP_MANIFEST_SCHEMA) return false;
  return (
    typeof value.backupId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.boundaryAt === 'string' &&
    typeof value.catalogPath === 'string' &&
    typeof value.catalogSha256 === 'string' &&
    Array.isArray(value.archiveIds) &&
    typeof value.contentDigest === 'string'
  );
}
