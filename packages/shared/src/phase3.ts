import type { Schedule } from './schedule';

export const BACKUP_MANIFEST_SCHEMA = 1 as const;
export const SNAPSHOT_MANIFEST_SCHEMA = 1 as const;

export const BACKUP_PROFILES = ['catalog-only', 'selected-collections', 'complete'] as const;
export type BackupProfile = (typeof BACKUP_PROFILES)[number];

export const BACKUP_TARGET_TYPES = ['local', 'sftp', 's3'] as const;
export type BackupTargetType = (typeof BACKUP_TARGET_TYPES)[number];

export const BACKUP_STATES = ['queued', 'running', 'completed', 'failed', 'verifying', 'verified'] as const;
export type BackupRunState = (typeof BACKUP_STATES)[number];

export const SNAPSHOT_CAUSES = ['sync-change', 'scheduled', 'manual'] as const;
export type SnapshotCause = (typeof SNAPSHOT_CAUSES)[number];

export const RECOVERY_KINDS = ['single-asset', 'single-archive', 'catalog', 'storage-pool', 'full-installation'] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

export const DEPENDENCY_RESOLUTIONS = ['resolved', 'unresolved', 'private', 'removed', 'rate-limited', 'ambiguous'] as const;
export type DependencyResolution = (typeof DEPENDENCY_RESOLUTIONS)[number];

export const DEPENDENCY_KINDS = ['git-submodule', 'git-url', 'npm-package', 'go-module', 'cargo-crate', 'python-package'] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface BackupRetentionPolicy {
  keepLast: number | null;
  maxAgeDays: number | null;
  maxBytes: number | null;
}

export interface BackupTargetLocal {
  type: 'local';
  path: string;
}

export interface BackupTargetSftp {
  type: 'sftp';
  host: string;
  port: number;
  username: string;
  remotePath: string;
  /** Stored encrypted in job payload only; never persisted in settings JSON. */
  password?: string;
  privateKey?: string;
}

export interface BackupTargetS3 {
  type: 's3';
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  accessKeyId: string;
  /** Job payload only. */
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

export type BackupTargetConfig = BackupTargetLocal | BackupTargetSftp | BackupTargetS3;

export interface BackupSettings {
  enabled: boolean;
  schedule: Schedule | null;
  profile: BackupProfile;
  collectionIds: string[];
  targets: BackupTargetConfig[];
  retention: BackupRetentionPolicy;
  verifyAfterUpload: boolean;
}

export interface SnapshotRetentionPolicy {
  keepLast: number | null;
  maxAgeDays: number | null;
  protectPinned: boolean;
}

export interface SnapshotSettings {
  onChange: boolean;
  manual: boolean;
  schedule: Schedule | null;
  retention: SnapshotRetentionPolicy;
}

export interface DependencyDiscoverySettings {
  autoDiscover: boolean;
  requireApproval: boolean;
  maxDepth: number;
  maxNewRepositories: number;
  maxTotalBytes: number;
  skipPackageTypes: DependencyKind[];
}

export interface Phase3Settings {
  backups: BackupSettings;
  snapshots: SnapshotSettings;
  dependencies: DependencyDiscoverySettings;
  selfPreservation: {
    enabled: boolean;
    enrollResolvedSources: boolean;
    collectionName: string;
  };
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: false,
  schedule: null,
  profile: 'complete',
  collectionIds: [],
  targets: [],
  retention: { keepLast: 8, maxAgeDays: null, maxBytes: null },
  verifyAfterUpload: true,
};

export const DEFAULT_SNAPSHOT_SETTINGS: SnapshotSettings = {
  onChange: true,
  manual: true,
  schedule: null,
  retention: { keepLast: 12, maxAgeDays: null, protectPinned: true },
};

export const DEFAULT_DEPENDENCY_SETTINGS: DependencyDiscoverySettings = {
  autoDiscover: false,
  requireApproval: true,
  maxDepth: 2,
  maxNewRepositories: 100,
  maxTotalBytes: 50 * 1024 * 1024 * 1024,
  skipPackageTypes: [],
};

export const DEFAULT_PHASE3_SETTINGS: Phase3Settings = {
  backups: DEFAULT_BACKUP_SETTINGS,
  snapshots: DEFAULT_SNAPSHOT_SETTINGS,
  dependencies: DEFAULT_DEPENDENCY_SETTINGS,
  selfPreservation: {
    enabled: false,
    enrollResolvedSources: false,
    collectionName: 'system-dependencies',
  },
};

export interface BackupManifestV1 {
  schemaVersion: typeof BACKUP_MANIFEST_SCHEMA;
  backupId: string;
  createdAt: string;
  boundaryAt: string;
  profile: BackupProfile;
  catalogPath: string;
  catalogSha256: string;
  archiveIds: string[];
  poolRoots: { poolId: string; relativeRoot: string; sha256: string }[];
  searchIndexIncluded: boolean;
  destination: { type: BackupTargetType; redacted: Record<string, unknown> };
  contentDigest: string;
}

export interface SnapshotManifestV1 {
  schemaVersion: typeof SNAPSHOT_MANIFEST_SCHEMA;
  snapshotId: string;
  repositoryId: string;
  cause: SnapshotCause;
  createdAt: string;
  contentDigest: string;
  archiveGeneration: number;
  archiveContentHash: string;
  refs: { name: string; oid: string; kind: 'current' | 'archived' }[];
  assets: { path: string; sha256: string; bytes: number }[];
}

export interface BackupRunSummary {
  id: string;
  profile: BackupProfile;
  targetType: BackupTargetType;
  state: BackupRunState;
  byteSize: number | null;
  contentDigest: string | null;
  boundaryAt: string;
  verifiedAt: string | null;
  verifyStatus: string | null;
  error: string | null;
  manifestPath: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ArchiveSnapshotSummary {
  id: string;
  repositoryId: string;
  repositoryName: string;
  cause: SnapshotCause;
  contentDigest: string;
  pinned: boolean;
  createdAt: string;
}

export interface RetentionPreviewItem {
  id: string;
  label: string;
  createdAt: string;
  byteSize: number | null;
  protected: boolean;
  reason: string | null;
}

export interface RetentionPreview {
  wouldDelete: RetentionPreviewItem[];
  wouldKeep: RetentionPreviewItem[];
}

export interface DependencyNodeView {
  id: string;
  identityKey: string;
  kind: DependencyKind;
  url: string | null;
  version: string | null;
  resolution: DependencyResolution;
  repositoryId: string | null;
  discoveredAt: string;
}

export interface DependencyEdgeView {
  id: string;
  fromRepositoryId: string;
  toNodeId: string;
  kind: DependencyKind;
  originPath: string;
}

export interface DependencyExpansionPreview {
  newRepositories: number;
  estimatedBytes: number;
  depth: number;
  nodes: DependencyNodeView[];
  unresolved: { originPath: string; reference: string; reason: string }[];
  cycles: string[];
  exceedsLimits: boolean;
  limitReasons: string[];
}

export interface RecoveryRunSummary {
  id: string;
  kind: RecoveryKind;
  sandbox: boolean;
  status: string;
  sourceBackupId: string | null;
  operatorNote: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SelfPreservationReport {
  generatedAt: string;
  applicationVersion: string;
  inventorySha256: string | null;
  enrolled: { name: string; version: string; repositoryId: string | null; url: string | null }[];
  missing: { name: string; reason: string }[];
  restorationNotes: string[];
}
