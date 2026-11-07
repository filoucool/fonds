import type {
  ArchiveStatus,
  ComponentKey,
  ComponentSnapshot,
  ComponentState,
  ExportFormat,
  HealthState,
  JobState,
  JobType,
  ProviderKind,
  UpstreamStatus,
} from './components';
import type { ArchivalProfileConfig, ProfileOverrides } from './profiles';
import type { Schedule } from './schedule';

export interface RepositorySummary {
  id: string;
  canonicalUrl: string;
  fetchUrl: string;
  displayName: string;
  description: string;
  provider: ProviderKind;
  archiveStatus: ArchiveStatus;
  upstreamStatus: UpstreamStatus;
  health: HealthState;
  defaultBranch: string | null;
  sizeBytes: number;
  category: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
  components: ComponentSnapshot[];
  storagePool: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
}

export interface RepositoryDetail extends RepositorySummary {
  license: string | null;
  relativePath: string;
  metadata: Record<string, unknown>;
  profile: {
    id: string;
    name: string;
    overrides: ProfileOverrides;
    effective: ArchivalProfileConfig;
  };
  sync: {
    profileId: string;
    profileName: string;
    paused: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
    schedule: Schedule;
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ArchiveEvent {
  id: string;
  repositoryId: string | null;
  repositoryName: string | null;
  kind: string;
  message: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface JobStep {
  id: string;
  component: string;
  state: string;
  sequence: number;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Job {
  id: string;
  repositoryId: string | null;
  repositoryName: string | null;
  type: JobType;
  state: JobState;
  priority: number;
  attempt: number;
  maxAttempts: number;
  errorCategory: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  notBefore: string | null;
  steps: JobStep[];
}

export interface AppSettings {
  maxConcurrentJobs: number;
  allowPrivateNetworks: boolean;
  privateNetworkExceptions: string[];
  allowFileUrls: boolean;
  githubHosts: string[];
  gitlabHosts: string[];
  placementMode: 'most-free' | 'default-pool' | 'manual';
  defaultPoolId: string | null;
  balancingEnabled: boolean;
  balanceHighWatermarkRatio: number;
  balanceLowWatermarkRatio: number;
  defaultArchivalProfileId: string | null;
  defaultSyncProfileId: string | null;
  requestTimeoutMs: number;
  gitTimeoutMs: number;
  maxAttempts: number;
  maxProviderPages: number;
}

export interface CredentialSummary {
  id: string;
  provider: ProviderKind;
  label: string;
  hint: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  repositoryCount: number;
}

export interface StoragePoolView {
  id: string;
  name: string;
  rootPath: string;
  freeSpaceThresholdBytes: number;
  acceptNew: boolean;
  enabled: boolean;
  placementWeight: number;
  freeBytes: number;
  totalBytes: number;
  repositoryCount: number;
  createdAt: string;
}

export interface ExportRecord {
  id: string;
  repositoryId: string;
  format: ExportFormat;
  status: string;
  byteSize: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Dashboard {
  countsByStatus: Partial<Record<ArchiveStatus, number>>;
  jobs: { queued: number; running: number; failed: number; paused: number };
  storage: {
    pools: {
      id: string;
      name: string;
      freeBytes: number;
      totalBytes: number;
      thresholdBytes: number;
      repositoryCount: number;
    }[];
  };
  recentEvents: ArchiveEvent[];
  dueSyncs: { repositoryId: string; repositoryName: string; nextRunAt: string | null }[];
  attentionComponents: {
    repositoryId: string;
    repositoryName: string;
    component: string;
    state: string;
    error: string | null;
  }[];
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: 'tree' | 'blob' | 'submodule' | 'symlink';
  mode: string;
  oid: string;
  sizeBytes: number | null;
}

export interface CommitView {
  oid: string;
  shortOid: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  parentOids: string[];
}

export interface RefView {
  name: string;
  oid: string;
  shortOid: string;
}

export interface ArchivedRefView extends RefView {
  reason: string;
  recordedAt: string;
  sourceRef: string;
}

export interface TextRecord {
  id: string;
  number: number | null;
  title: string;
  state: string;
  author: string;
  createdAt: string | null;
  updatedAt: string | null;
  body: string;
  url: string | null;
  bodyTruncated: boolean;
}

export interface ReleaseAssetView {
  id: string;
  name: string;
  byteSize: number | null;
  sha256: string | null;
  state: string;
  error: string | null;
}

export interface ReleaseView {
  id: string;
  tag: string;
  title: string;
  body: string;
  state: string;
  author: string;
  createdAt: string | null;
  url: string | null;
  assets: ReleaseAssetView[];
}

export interface IntegrityCheck {
  id: string;
  component: ComponentKey | 'checksums' | 'manifest';
  ok: boolean;
  detail: string;
}

export interface IntegrityRun {
  id: string;
  scope: string;
  verificationType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  results: { ok: boolean; checks: IntegrityCheck[] };
}

export interface ArchivalProfileView {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  config: ArchivalProfileConfig;
  createdAt: string;
  updatedAt: string;
}

export interface SyncProfileView {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  schedule: Schedule;
  timezone: string;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export type { ComponentState };
