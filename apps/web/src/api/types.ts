export type ArchiveStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'healthy'
  | 'partial'
  | 'unavailable'
  | 'corrupt'
  | 'deleted';

export type ComponentState =
  | 'pending'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'unsupported'
  | 'skipped'
  | 'paused';

export type ComponentKey =
  | 'git'
  | 'pullRefs'
  | 'metadata'
  | 'releases'
  | 'releaseAssets'
  | 'issues'
  | 'issueComments'
  | 'pullRequests'
  | 'pullRequestComments'
  | 'discussions'
  | 'wiki'
  | 'docs'
  | 'lfs'
  | 'submodules';

export type JobState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'partial'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobType = 'sync' | 'verify' | 'export' | 'migrate' | 'import' | 'rebuild' | 'index';

export type Health = 'unknown' | 'ok' | 'warning' | 'corrupt';

export type Upstream = 'unknown' | 'reachable' | 'unavailable' | 'not_found' | 'auth_required';

export type Provider = 'github' | 'gitlab' | 'git';

export type PlacementMode = 'most-free' | 'default-pool' | 'manual';

export type ExportFormat = 'bundle' | 'directory' | 'package';

export type TreeKind = 'tree' | 'blob' | 'submodule' | 'symlink';

export type TreeSpace = 'repository' | 'wiki';

export type Schedule =
  | { kind: 'manual' }
  | { kind: 'interval'; everySeconds: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

export interface ArchivalLimits {
  maxRepositoryBytes: number | null;
  maxAssetBytes: number | null;
  maxComponentBytes: number | null;
}

export interface ArchivalProfileConfig {
  components: Record<ComponentKey, boolean>;
  limits: ArchivalLimits;
  exclusions: string[];
}

export interface ProfileOverrides {
  components?: Partial<Record<ComponentKey, boolean>>;
  limits?: {
    maxRepositoryBytes?: number | null;
    maxAssetBytes?: number | null;
    maxComponentBytes?: number | null;
  };
  exclusions?: string[];
}

export interface NamedId {
  id: string;
  name: string;
}

export interface ComponentRecord {
  component: ComponentKey;
  state: ComponentState;
  sizeBytes: number;
  lastSuccessAt: string | null;
  error: string | null;
}

export interface RepositorySummary {
  id: string;
  canonicalUrl: string;
  fetchUrl: string;
  displayName: string;
  description: string | null;
  provider: Provider;
  archiveStatus: ArchiveStatus;
  upstreamStatus: Upstream;
  health: Health;
  defaultBranch: string | null;
  sizeBytes: number;
  category: NamedId | null;
  tags: NamedId[];
  components: ComponentRecord[];
  storagePool: NamedId | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
}

export interface RepositoryProfileBinding {
  id: string | null;
  name: string | null;
  overrides: ProfileOverrides | null;
  effective: ArchivalProfileConfig;
}

export interface RepositorySyncBinding {
  profileId: string | null;
  profileName: string | null;
  paused: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  schedule: Schedule | null;
}

export interface RepositoryDetail extends RepositorySummary {
  license: string | null;
  relativePath: string | null;
  metadata: Record<string, unknown>;
  profile: RepositoryProfileBinding | null;
  sync: RepositorySyncBinding | null;
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
  detail: unknown;
}

export interface JobStep {
  id: string;
  component: string | null;
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

export interface Settings {
  maxConcurrentJobs: number;
  allowPrivateNetworks: boolean;
  privateNetworkExceptions: string[];
  allowFileUrls: boolean;
  githubHosts: string[];
  gitlabHosts: string[];
  placementMode: PlacementMode;
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
  dashboardWidgets: DashboardWidgetId[];
  auth?: { mode: 'trusted' | 'local' | 'oidc' };
  gitAccess?: { publicBaseUrl: string | null; httpEnabled?: boolean; sshEnabled?: boolean; sshPort?: number };
  search?: { globalIndexingEnabled: boolean };
}

export const DASHBOARD_WIDGET_IDS = ['status', 'jobs', 'due', 'attention', 'storage', 'events'] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

export interface CredentialSummary {
  id: string;
  provider: string;
  label: string;
  hint: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
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
  description: string | null;
  createdAt: string;
  repositoryCount: number;
}

export interface Pool {
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

export interface TreeEntry {
  name: string;
  path: string;
  kind: TreeKind;
  mode: string;
  oid: string;
  sizeBytes: number | null;
}

export interface CommitItem {
  oid: string;
  shortOid: string;
  summary: string;
  authorName: string;
  authoredAt: string;
  parentOids: string[];
}

export interface CurrentRef {
  name: string;
  oid: string;
  shortOid: string;
}

export interface ArchivedRef extends CurrentRef {
  reason: string | null;
  recordedAt: string;
  sourceRef: string | null;
}

export interface RefsResponse {
  current: CurrentRef[];
  archived: ArchivedRef[];
}

export interface DiscussionItem {
  id: string;
  providerKey: string;
  parentKey: string | null;
  number: number | null;
  title: string;
  state: string;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  body: string | null;
  url: string | null;
  bodyTruncated: boolean;
  upstreamMissing: boolean;
}

export interface LfsObject {
  path: string;
  oid: string;
  size: number;
}

export interface ReleaseAsset {
  id: string;
  name: string;
  byteSize: number | null;
  sha256: string | null;
  state: string;
  error: string | null;
}

export interface ReleaseItem {
  id: string;
  tag: string;
  title: string | null;
  body: string | null;
  state: string;
  author: string | null;
  createdAt: string;
  url: string | null;
  upstreamMissing: boolean;
  assets: ReleaseAsset[];
}

export interface IntegrityCheck {
  id: string;
  component: string | null;
  ok: boolean;
  detail: string | null;
}

export interface IntegrityRun {
  id: string;
  scope: string;
  verificationType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  results: {
    ok: boolean;
    checks: IntegrityCheck[];
  } | null;
}

export interface BlobResponse {
  ref: string;
  path: string;
  oid: string;
  sizeBytes: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
}

export interface DashboardPool {
  id: string;
  name: string;
  freeBytes: number;
  totalBytes: number;
  thresholdBytes: number;
  repositoryCount: number;
}

export interface DueSync {
  repositoryId?: string;
  id?: string;
  repositoryName?: string;
  displayName?: string;
  name?: string;
  nextRunAt?: string | null;
}

export interface AttentionItem {
  repositoryId?: string;
  repositoryName?: string;
  component?: string;
  state?: string;
  error?: string | null;
}

export interface Dashboard {
  countsByStatus: Partial<Record<ArchiveStatus, number>>;
  jobs: {
    queued: number;
    running: number;
    failed: number;
    paused: number;
  };
  storage: {
    pools: DashboardPool[];
  };
  recentEvents: ArchiveEvent[];
  dueSyncs: DueSync[];
  attentionComponents: AttentionItem[] | number;
}

export interface ArchivalProfile {
  id: string;
  name: string;
  description: string | null;
  config: ArchivalProfileConfig;
  builtin?: boolean;
  system?: boolean;
  isBuiltin?: boolean;
  readOnly?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SyncProfile {
  id: string;
  name: string;
  description: string | null;
  schedule: Schedule;
  timezone: string;
  paused: boolean;
  builtin?: boolean;
  system?: boolean;
  isBuiltin?: boolean;
  readOnly?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RepositoryQuery {
  limit?: number;
  cursor?: string;
  q?: string;
  status?: ArchiveStatus | '';
  provider?: Provider | '';
  categoryId?: string;
  tagId?: string;
  collectionId?: string;
  sort?: 'updated' | 'name' | 'size';
  includeDeleted?: boolean;
}

export interface CreateRepositoryInput {
  url: string;
  displayName?: string;
  profileId?: string;
  syncProfileId?: string;
  categoryId?: string;
  tagIds?: string[];
}

export interface CreateRepositoryResult {
  repository: RepositoryDetail;
  jobId: string | null;
}

export interface ImportInput {
  text: string;
  format: 'text' | 'csv';
  profileId?: string;
  syncProfileId?: string;
  categoryId?: string;
}

export interface ImportCreated {
  id: string;
  url: string;
  jobId: string | null;
}

export interface ImportDuplicate {
  url: string;
  existingId: string;
}

export interface ImportInvalid {
  line: number;
  url: string;
  error: string;
}

export interface ImportResult {
  created: ImportCreated[];
  duplicates: ImportDuplicate[];
  invalid: ImportInvalid[];
}

export interface BulkInput {
  action: 'sync' | 'verify' | 'export' | 'delete';
  ids: string[];
  confirm?: boolean;
  exportFormat?: ExportFormat;
}

export interface BulkResult {
  jobIds: string[];
  deletedIds: string[];
  exportIds: string[];
}

export interface RepositoryPatch {
  displayName?: string;
  description?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
  profileId?: string | null;
  syncProfileId?: string | null;
  syncPaused?: boolean;
  overrides?: ProfileOverrides | null;
}

export interface ArchivalProfileInput {
  name: string;
  description?: string | null;
  config: ArchivalProfileConfig;
}

export interface SyncProfileInput {
  name: string;
  description?: string | null;
  schedule: Schedule;
  timezone: string;
  paused: boolean;
}

export interface PoolCreate {
  name: string;
  rootPath: string;
  freeSpaceThresholdBytes: number;
  acceptNew: boolean;
  placementWeight: number;
}

export interface PoolPatch {
  freeSpaceThresholdBytes?: number;
  acceptNew?: boolean;
  enabled?: boolean;
  placementWeight?: number;
}

export interface CredentialInput {
  provider: Provider;
  label: string;
  token: string;
}

export interface JobQuery {
  state?: JobState | '';
  cursor?: string;
  limit?: number;
}

export interface CursorQuery {
  cursor?: string;
  limit?: number;
  ref?: string;
}

export interface TreeQuery {
  ref?: string;
  path?: string;
  space: TreeSpace;
}

export interface JobRef {
  jobId: string;
}

export interface ExportCreateResult {
  jobId: string;
  exportId: string;
}

export interface BackupResult {
  path: string;
  bytes: number;
}
