import type {
  ArchivalProfile,
  ArchivalProfileInput,
  ArchiveEvent,
  BackupResult,
  BlobResponse,
  BulkInput,
  BulkResult,
  Category,
  Collection,
  CommitItem,
  ComponentRecord,
  CreateRepositoryInput,
  CreateRepositoryResult,
  CredentialInput,
  CredentialSummary,
  CursorQuery,
  Dashboard,
  DiscussionItem,
  ExportCreateResult,
  ExportRecord,
  ImportInput,
  ImportResult,
  IntegrityRun,
  Job,
  LfsObject,
  JobQuery,
  JobRef,
  Page,
  Pool,
  PoolCreate,
  PoolPatch,
  StoragePathCandidate,
  RefsResponse,
  ReleaseItem,
  RepositoryDetail,
  RepositoryPatch,
  RepositoryQuery,
  RepositorySummary,
  Settings,
  SyncProfile,
  SyncProfileInput,
  Tag,
  TreeEntry,
  TreeQuery,
} from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Request failed';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let csrfToken: string | null = null;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error.trim()) return data.error;
  } catch {
    /* non-JSON error body */
  }
  return response.statusText || `Request failed (${response.status})`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(path, { ...init, headers, cache: 'no-store', credentials: 'include' });
  if (!response.ok) throw new ApiError(await readError(response), response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Response was not valid JSON', response.status);
  }
}

function expectPage<T>(data: unknown, label: string): Page<T> {
  if (!isRecord(data) || !Array.isArray(data.items)) {
    throw new ApiError(`${label} returned an unexpected payload`, 200);
  }
  return {
    items: data.items as T[],
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
  };
}

function expectList<T>(data: unknown, label: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (isRecord(data) && Array.isArray(data.items)) return data.items as T[];
  throw new ApiError(`${label} returned an unexpected payload`, 200);
}

function repositoryId(id: string): string {
  return encodeURIComponent(id);
}

function optionalId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function getHealth(): Promise<unknown> {
  return request<unknown>('/api/health');
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function getDashboard(): Promise<Dashboard> {
  const data = await request<unknown>('/api/dashboard');
  const record = isRecord(data) ? data : {};
  const jobs = isRecord(record.jobs) ? record.jobs : {};
  const storage = isRecord(record.storage) ? record.storage : {};
  const attention = record.attentionComponents;
  return {
    countsByStatus: isRecord(record.countsByStatus)
      ? (record.countsByStatus as Dashboard['countsByStatus'])
      : {},
    jobs: {
      queued: numberField(jobs.queued),
      running: numberField(jobs.running),
      failed: numberField(jobs.failed),
      paused: numberField(jobs.paused),
    },
    storage: {
      pools: Array.isArray(storage.pools) ? (storage.pools as Dashboard['storage']['pools']) : [],
    },
    recentEvents: Array.isArray(record.recentEvents)
      ? (record.recentEvents as Dashboard['recentEvents'])
      : [],
    dueSyncs: Array.isArray(record.dueSyncs) ? (record.dueSyncs as Dashboard['dueSyncs']) : [],
    attentionComponents:
      typeof attention === 'number' || Array.isArray(attention)
        ? (attention as Dashboard['attentionComponents'])
        : [],
  };
}

async function listRepositories(query: RepositoryQuery = {}): Promise<Page<RepositorySummary>> {
  const data = await request<unknown>(
    `/api/repositories${qs({
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      status: query.status,
      provider: query.provider,
      categoryId: query.categoryId,
      tagId: query.tagId,
      collectionId: query.collectionId,
      storagePoolId: query.storagePoolId,
      sort: query.sort,
      includeDeleted: query.includeDeleted ? 'true' : undefined,
    })}`,
  );
  return expectPage<RepositorySummary>(data, 'Repositories');
}

async function createRepository(input: CreateRepositoryInput): Promise<CreateRepositoryResult> {
  const body: CreateRepositoryInput = { url: input.url.trim() };
  const displayName = input.displayName?.trim();
  const profileId = optionalId(input.profileId);
  const syncProfileId = optionalId(input.syncProfileId);
  const categoryId = optionalId(input.categoryId);
  if (displayName) body.displayName = displayName;
  if (profileId) body.profileId = profileId;
  if (syncProfileId) body.syncProfileId = syncProfileId;
  if (categoryId) body.categoryId = categoryId;
  if (input.tagIds?.length) body.tagIds = input.tagIds;
  const data = await request<unknown>('/api/repositories', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!isRecord(data) || !isRecord(data.repository)) {
    throw new ApiError('Create repository returned an unexpected payload', 200);
  }
  return {
    repository: data.repository as unknown as RepositoryDetail,
    jobId: typeof data.jobId === 'string' ? data.jobId : null,
  };
}

async function importRepositories(input: ImportInput): Promise<ImportResult> {
  const body: ImportInput = { text: input.text, format: input.format };
  const profileId = optionalId(input.profileId);
  const syncProfileId = optionalId(input.syncProfileId);
  const categoryId = optionalId(input.categoryId);
  if (profileId) body.profileId = profileId;
  if (syncProfileId) body.syncProfileId = syncProfileId;
  if (categoryId) body.categoryId = categoryId;
  const data = await request<unknown>('/api/repositories/import', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (
    !isRecord(data) ||
    !Array.isArray(data.created) ||
    !Array.isArray(data.duplicates) ||
    !Array.isArray(data.invalid)
  ) {
    throw new ApiError('Import returned an unexpected payload', 200);
  }
  return data as unknown as ImportResult;
}

async function bulkRepositories(input: BulkInput): Promise<BulkResult> {
  if (input.action === 'delete' && input.confirm !== true) {
    throw new ApiError('Soft delete requires confirmation', 0);
  }
  if (input.action === 'export' && !input.exportFormat) {
    throw new ApiError('Export requires a format', 0);
  }
  const body: BulkInput = { action: input.action, ids: input.ids };
  if (input.action === 'delete') body.confirm = true;
  if (input.action === 'export') body.exportFormat = input.exportFormat;
  const data = await request<unknown>('/api/repositories/bulk', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!isRecord(data)) throw new ApiError('Bulk action returned an unexpected payload', 200);
  return {
    jobIds: Array.isArray(data.jobIds) ? (data.jobIds as string[]) : [],
    deletedIds: Array.isArray(data.deletedIds) ? (data.deletedIds as string[]) : [],
    exportIds: Array.isArray(data.exportIds) ? (data.exportIds as string[]) : [],
  };
}

async function getRepository(id: string): Promise<RepositoryDetail> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}`);
  if (isRecord(data) && isRecord(data.repository)) return data.repository as unknown as RepositoryDetail;
  return data as RepositoryDetail;
}

async function updateRepository(id: string, patch: RepositoryPatch): Promise<unknown> {
  return request<unknown>(`/api/repositories/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function deleteRepository(id: string): Promise<void> {
  await request<unknown>(`/api/repositories/${repositoryId(id)}?confirm=true`, { method: 'DELETE' });
}

async function restoreRepository(id: string): Promise<unknown> {
  return request<unknown>(`/api/repositories/${repositoryId(id)}/restore`, { method: 'POST' });
}

async function purgeRepository(id: string, confirmName: string): Promise<unknown> {
  return request<unknown>(`/api/repositories/${repositoryId(id)}/purge`, {
    method: 'POST',
    body: JSON.stringify({ confirmName }),
  });
}

async function syncRepository(id: string): Promise<JobRef> {
  return request<JobRef>(`/api/repositories/${repositoryId(id)}/sync`, { method: 'POST' });
}

async function verifyRepository(id: string): Promise<JobRef> {
  return request<JobRef>(`/api/repositories/${repositoryId(id)}/verify`, { method: 'POST' });
}

async function exportRepository(id: string, format: ExportRecord['format']): Promise<ExportCreateResult> {
  return request<ExportCreateResult>(`/api/repositories/${repositoryId(id)}/export`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}

async function getRefs(id: string): Promise<RefsResponse> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}/refs`);
  if (!isRecord(data) || !Array.isArray(data.current) || !Array.isArray(data.archived)) {
    throw new ApiError('Refs returned an unexpected payload', 200);
  }
  return { current: data.current as RefsResponse['current'], archived: data.archived as RefsResponse['archived'] };
}

async function listCommits(id: string, query: CursorQuery = {}): Promise<Page<CommitItem>> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/commits${qs({
      cursor: query.cursor,
      limit: query.limit,
      ref: query.ref,
    })}`,
  );
  return expectPage<CommitItem>(data, 'Commits');
}

async function getTree(id: string, query: TreeQuery): Promise<TreeEntry[]> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/tree${qs({
      ref: query.ref,
      path: query.path,
      space: query.space,
    })}`,
  );
  if (Array.isArray(data)) return data as TreeEntry[];
  if (isRecord(data) && Array.isArray(data.entries)) return data.entries as TreeEntry[];
  if (isRecord(data) && Array.isArray(data.items)) return data.items as TreeEntry[];
  throw new ApiError('Tree returned an unexpected payload', 200);
}

async function getBlob(id: string, query: TreeQuery): Promise<BlobResponse> {
  return request<BlobResponse>(
    `/api/repositories/${repositoryId(id)}/blob${qs({
      ref: query.ref,
      path: query.path,
      space: query.space,
    })}`,
  );
}

function blobRawUrl(id: string, query: TreeQuery): string {
  return `/api/repositories/${repositoryId(id)}/blob/raw${qs({
    ref: query.ref,
    path: query.path,
    space: query.space,
  })}`;
}

async function listComponents(id: string): Promise<ComponentRecord[]> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}/components`);
  if (isRecord(data) && Array.isArray(data.components)) return data.components as ComponentRecord[];
  return expectList<ComponentRecord>(data, 'Components');
}

async function listEvents(id: string, query: CursorQuery = {}): Promise<Page<ArchiveEvent>> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/events${qs({ cursor: query.cursor, limit: query.limit })}`,
  );
  return expectPage<ArchiveEvent>(data, 'Events');
}

async function listIssues(id: string, query: CursorQuery = {}): Promise<Page<DiscussionItem>> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/issues${qs({ cursor: query.cursor, limit: query.limit })}`,
  );
  return expectPage<DiscussionItem>(data, 'Issues');
}

async function listPulls(id: string, query: CursorQuery = {}): Promise<Page<DiscussionItem>> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/pulls${qs({ cursor: query.cursor, limit: query.limit })}`,
  );
  return expectPage<DiscussionItem>(data, 'Pull requests');
}

async function listDiscussions(id: string, query: CursorQuery = {}): Promise<Page<DiscussionItem>> {
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/discussions${qs({ cursor: query.cursor, limit: query.limit })}`,
  );
  return expectPage<DiscussionItem>(data, 'Discussions');
}

async function listComments(id: string, kind: 'issue' | 'pull', parents: string[]): Promise<DiscussionItem[]> {
  if (parents.length === 0) return [];
  const data = await request<unknown>(
    `/api/repositories/${repositoryId(id)}/comments${qs({ kind, parent: parents.join(',') })}`,
  );
  return expectList<DiscussionItem>(data, 'Comments');
}

async function listLfs(id: string): Promise<LfsObject[]> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}/lfs`);
  return expectList<LfsObject>(data, 'LFS objects');
}

async function listReleases(id: string): Promise<ReleaseItem[]> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}/releases`);
  return expectList<ReleaseItem>(data, 'Releases');
}

function assetDownloadUrl(id: string, assetId: string): string {
  return `/api/repositories/${repositoryId(id)}/assets/${encodeURIComponent(assetId)}`;
}

async function listIntegrity(id: string): Promise<IntegrityRun[]> {
  const data = await request<unknown>(`/api/repositories/${repositoryId(id)}/integrity`);
  if (isRecord(data) && Array.isArray(data.runs)) return data.runs as IntegrityRun[];
  return expectList<IntegrityRun>(data, 'Integrity');
}

async function listArchivalProfiles(): Promise<ArchivalProfile[]> {
  return expectList<ArchivalProfile>(await request<unknown>('/api/archival-profiles'), 'Archival profiles');
}

async function getArchivalProfile(id: string): Promise<ArchivalProfile> {
  const data = await request<unknown>(`/api/archival-profiles/${repositoryId(id)}`);
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as ArchivalProfile;
  return data as ArchivalProfile;
}

async function createArchivalProfile(input: ArchivalProfileInput): Promise<ArchivalProfile> {
  const data = await request<unknown>('/api/archival-profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as ArchivalProfile;
  return data as ArchivalProfile;
}

async function updateArchivalProfile(id: string, input: ArchivalProfileInput): Promise<ArchivalProfile> {
  const data = await request<unknown>(`/api/archival-profiles/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as ArchivalProfile;
  return data as ArchivalProfile;
}

async function deleteArchivalProfile(id: string): Promise<void> {
  await request<unknown>(`/api/archival-profiles/${repositoryId(id)}`, { method: 'DELETE' });
}

async function listSyncProfiles(): Promise<SyncProfile[]> {
  return expectList<SyncProfile>(await request<unknown>('/api/sync-profiles'), 'Sync profiles');
}

async function getSyncProfile(id: string): Promise<SyncProfile> {
  const data = await request<unknown>(`/api/sync-profiles/${repositoryId(id)}`);
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as SyncProfile;
  return data as SyncProfile;
}

async function createSyncProfile(input: SyncProfileInput): Promise<SyncProfile> {
  const data = await request<unknown>('/api/sync-profiles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as SyncProfile;
  return data as SyncProfile;
}

async function updateSyncProfile(id: string, input: SyncProfileInput): Promise<SyncProfile> {
  const data = await request<unknown>(`/api/sync-profiles/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (isRecord(data) && isRecord(data.profile)) return data.profile as unknown as SyncProfile;
  return data as SyncProfile;
}

async function deleteSyncProfile(id: string): Promise<void> {
  await request<unknown>(`/api/sync-profiles/${repositoryId(id)}`, { method: 'DELETE' });
}

async function listCategories(): Promise<Category[]> {
  return expectList<Category>(await request<unknown>('/api/categories'), 'Categories');
}

async function createCategory(body: { name: string; description?: string | null }): Promise<Category> {
  return request<Category>('/api/categories', { method: 'POST', body: JSON.stringify(body) });
}

async function updateCategory(
  id: string,
  body: { name: string; description?: string | null },
): Promise<Category> {
  return request<Category>(`/api/categories/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function deleteCategory(id: string): Promise<void> {
  await request<unknown>(`/api/categories/${repositoryId(id)}`, { method: 'DELETE' });
}

async function listTags(): Promise<Tag[]> {
  return expectList<Tag>(await request<unknown>('/api/tags'), 'Tags');
}

async function createTag(body: { name: string }): Promise<Tag> {
  return request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(body) });
}

async function deleteTag(id: string): Promise<void> {
  await request<unknown>(`/api/tags/${repositoryId(id)}`, { method: 'DELETE' });
}

async function listCollections(): Promise<Collection[]> {
  return expectList<Collection>(await request<unknown>('/api/collections'), 'Collections');
}

async function createCollection(body: { name: string; description?: string | null }): Promise<Collection> {
  return request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(body) });
}

async function updateCollection(
  id: string,
  body: { name: string; description?: string | null },
): Promise<Collection> {
  return request<Collection>(`/api/collections/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function deleteCollection(id: string): Promise<void> {
  await request<unknown>(`/api/collections/${repositoryId(id)}`, { method: 'DELETE' });
}

async function setCollectionRepositories(id: string, repositoryIds: string[]): Promise<unknown> {
  return request<unknown>(`/api/collections/${repositoryId(id)}/repositories`, {
    method: 'PUT',
    body: JSON.stringify({ repositoryIds }),
  });
}

function normalizeJob(data: unknown): Job {
  const record = isRecord(data) && isRecord(data.job) ? data.job : data;
  const job = record as Job;
  return { ...job, steps: Array.isArray(job.steps) ? job.steps : [] };
}

async function listJobs(query: JobQuery = {}): Promise<Page<Job>> {
  const data = await request<unknown>(
    `/api/jobs${qs({ state: query.state, cursor: query.cursor, limit: query.limit })}`,
  );
  const page = expectPage<Job>(data, 'Jobs');
  return { ...page, items: page.items.map((job) => normalizeJob(job)) };
}

async function getJob(id: string): Promise<Job> {
  return normalizeJob(await request<unknown>(`/api/jobs/${repositoryId(id)}`));
}

async function pauseJob(id: string): Promise<unknown> {
  return request<unknown>(`/api/jobs/${repositoryId(id)}/pause`, { method: 'POST' });
}

async function resumeJob(id: string): Promise<unknown> {
  return request<unknown>(`/api/jobs/${repositoryId(id)}/resume`, { method: 'POST' });
}

async function cancelJob(id: string): Promise<unknown> {
  return request<unknown>(`/api/jobs/${repositoryId(id)}/cancel`, { method: 'POST' });
}

async function retryJob(id: string): Promise<unknown> {
  return request<unknown>(`/api/jobs/${repositoryId(id)}/retry`, { method: 'POST' });
}

async function listPools(): Promise<Pool[]> {
  return expectList<Pool>(await request<unknown>('/api/storage/pools'), 'Storage pools');
}

async function listStoragePathCandidates(): Promise<StoragePathCandidate[]> {
  return expectList<StoragePathCandidate>(
    await request<unknown>('/api/storage/path-candidates'),
    'Storage path candidates',
  );
}

async function createPool(body: PoolCreate): Promise<Pool> {
  return request<Pool>('/api/storage/pools', { method: 'POST', body: JSON.stringify(body) });
}

async function updatePool(id: string, patch: PoolPatch): Promise<Pool> {
  return request<Pool>(`/api/storage/pools/${repositoryId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

async function migrateRepository(repositoryIdValue: string, destinationPoolId: string): Promise<JobRef> {
  return request<JobRef>('/api/storage/migrate', {
    method: 'POST',
    body: JSON.stringify({ repositoryId: repositoryIdValue, destinationPoolId }),
  });
}

async function listCredentials(): Promise<CredentialSummary[]> {
  return expectList<CredentialSummary>(await request<unknown>('/api/credentials'), 'Credentials');
}

async function createCredential(body: CredentialInput): Promise<CredentialSummary> {
  return request<CredentialSummary>('/api/credentials', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function deleteCredential(id: string): Promise<void> {
  await request<unknown>(`/api/credentials/${repositoryId(id)}`, { method: 'DELETE' });
}

async function getSettings(): Promise<Settings> {
  const data = await request<unknown>('/api/settings');
  if (!isRecord(data) || !isRecord(data.settings)) {
    throw new ApiError('Settings response did not include settings', 200);
  }
  return data.settings as unknown as Settings;
}

async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const data = await request<unknown>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!isRecord(data) || !isRecord(data.settings)) {
    throw new ApiError('Settings response did not include settings', 200);
  }
  return data.settings as unknown as Settings;
}

async function rebuildCatalog(): Promise<JobRef> {
  return request<JobRef>('/api/catalog/rebuild', { method: 'POST' });
}

async function importLocalArchive(sourcePath: string): Promise<JobRef> {
  return request<JobRef>('/api/catalog/import-local', {
    method: 'POST',
    body: JSON.stringify({ sourcePath }),
  });
}

async function backupSqlite(): Promise<BackupResult> {
  return request<BackupResult>('/api/maintenance/sqlite-backup', { method: 'POST' });
}

async function getInventory(): Promise<unknown> {
  return request<unknown>('/api/inventory');
}

async function getPhase3Settings(): Promise<import('./types').Phase3Settings> {
  return request<import('./types').Phase3Settings>('/api/phase3/settings');
}

async function patchPhase3Settings(patch: Record<string, unknown>): Promise<import('./types').Phase3Settings> {
  return request<import('./types').Phase3Settings>('/api/phase3/settings', { method: 'POST', body: JSON.stringify(patch) });
}

async function listBackups(): Promise<{ items: import('./types').BackupRunSummary[] }> {
  return request<{ items: import('./types').BackupRunSummary[] }>('/api/phase3/backups');
}

async function runBackup(target: Record<string, unknown>, profile: string): Promise<{ jobId: string; backupId: string }> {
  return request<{ jobId: string; backupId: string }>('/api/phase3/backups/run', { method: 'POST', body: JSON.stringify({ target, profile }) });
}

async function getSelfPreservationReport(): Promise<import('./types').SelfPreservationReport> {
  return request<import('./types').SelfPreservationReport>('/api/phase3/supply-chain/report');
}

type ArchiveSnapshotSummary = {
  id: string;
  repositoryId: string;
  repositoryName: string;
  cause: string;
  contentDigest: string;
  pinned: boolean;
  createdAt: string;
};

async function listRepositorySnapshots(repositoryId: string): Promise<{ items: ArchiveSnapshotSummary[] }> {
  return request<{ items: ArchiveSnapshotSummary[] }>(`/api/phase3/repositories/${encodeURIComponent(repositoryId)}/snapshots`);
}

async function createRepositorySnapshot(repositoryId: string): Promise<ArchiveSnapshotSummary> {
  return request<ArchiveSnapshotSummary>(`/api/phase3/repositories/${encodeURIComponent(repositoryId)}/snapshots`, { method: 'POST', body: '{}' });
}

async function globalSearch(q: string, capabilities: string, filters: Record<string, string | undefined> = {}): Promise<{ items: GlobalSearchHit[]; usageBytes: number }> {
  return request<{ items: GlobalSearchHit[]; usageBytes: number }>(`/api/search${qs({ q, capabilities, ...filters })}`);
}

type AuthSession = { authenticated: boolean; mode: string; user?: { username: string }; csrfToken?: string };

async function getAuthSession(): Promise<AuthSession> {
  const data = await request<AuthSession>('/api/auth/session');
  if (data.authenticated && data.csrfToken) csrfToken = data.csrfToken;
  return data;
}

async function login(username: string, password: string): Promise<void> {
  const data = await request<{ csrfToken?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.csrfToken) csrfToken = data.csrfToken;
}

async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' });
  csrfToken = null;
}

type SearchIndexStatus = {
  repositoryId: string;
  state: string;
  enabled: { filenames: boolean; sourceText: boolean; metadata: boolean };
  fileCount: number;
  sourceTextBytes: number;
};

async function getSearchIndex(id: string): Promise<SearchIndexStatus> {
  return request<SearchIndexStatus>(`/api/repositories/${repositoryId(id)}/search-index`);
}

async function patchSearchIndex(id: string, enabled: { filenames?: boolean; sourceText?: boolean }): Promise<SearchIndexStatus> {
  return request<SearchIndexStatus>(`/api/repositories/${repositoryId(id)}/search-index`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

async function rebuildSearchIndex(id: string): Promise<{ jobId: string }> {
  return request<{ jobId: string }>(`/api/repositories/${repositoryId(id)}/search-index/rebuild`, { method: 'POST' });
}

async function pauseSearchIndex(id: string): Promise<SearchIndexStatus> {
  return request<SearchIndexStatus>(`/api/repositories/${repositoryId(id)}/search-index/pause`, { method: 'POST' });
}

async function resumeSearchIndex(id: string): Promise<{ status: SearchIndexStatus; jobId: string }> {
  return request<{ status: SearchIndexStatus; jobId: string }>(`/api/repositories/${repositoryId(id)}/search-index/resume`, { method: 'POST' });
}

async function deleteSearchIndex(id: string): Promise<void> {
  await request<void>(`/api/repositories/${repositoryId(id)}/search-index`, { method: 'DELETE' });
}

async function listSshKeys(): Promise<{ id: string; label: string; fingerprint: string }[]> {
  const data = await request<{ items: { id: string; label: string; fingerprint: string }[] }>('/api/ssh-keys');
  return data.items;
}

async function addSshKey(label: string, publicKey: string): Promise<void> {
  await request('/api/ssh-keys', { method: 'POST', body: JSON.stringify({ label, publicKey }) });
}

async function listAccessTokens(): Promise<{ id: string; label: string; hint: string; scopes: string[] }[]> {
  const data = await request<{ items: { id: string; label: string; hint: string; scopes: string[] }[] }>('/api/access-tokens');
  return data.items;
}

async function createAccessToken(label: string, scopes: string[]): Promise<{ id: string; token: string; hint: string }> {
  return request<{ id: string; token: string; hint: string }>('/api/access-tokens', {
    method: 'POST',
    body: JSON.stringify({ label, scopes }),
  });
}

async function revokeAccessToken(id: string): Promise<void> {
  await request(`/api/access-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function getCloneUrls(id: string): Promise<{ https: string | null; ssh: string | null }> {
  return request<{ https: string | null; ssh: string | null }>(`/api/repositories/${repositoryId(id)}/clone-urls`);
}

type GlobalSearchHit = {
  repositoryId: string;
  displayName: string;
  kind: string;
  path: string | null;
  snippet: string | null;
};

async function getExport(id: string): Promise<ExportRecord> {
  const data = await request<unknown>(`/api/exports/${repositoryId(id)}`);
  if (isRecord(data) && isRecord(data.export)) return data.export as unknown as ExportRecord;
  return data as ExportRecord;
}

function exportDownloadUrl(id: string): string {
  return `/api/exports/${repositoryId(id)}/download`;
}

export function describeHealth(data: unknown): { ok: boolean; text: string } {
  if (!isRecord(data)) return { ok: true, text: 'responding' };
  const status = typeof data.status === 'string' ? data.status : '';
  if (data.ok === false || status === 'error' || status === 'unhealthy') {
    return { ok: false, text: status || 'unhealthy' };
  }
  return { ok: true, text: status || 'responding' };
}

export const api = {
  getHealth,
  getDashboard,
  listRepositories,
  createRepository,
  importRepositories,
  bulkRepositories,
  getRepository,
  updateRepository,
  deleteRepository,
  restoreRepository,
  purgeRepository,
  syncRepository,
  verifyRepository,
  exportRepository,
  getRefs,
  listCommits,
  getTree,
  getBlob,
  blobRawUrl,
  listComponents,
  listEvents,
  listIssues,
  listPulls,
  listDiscussions,
  listComments,
  listLfs,
  listReleases,
  assetDownloadUrl,
  listIntegrity,
  listArchivalProfiles,
  getArchivalProfile,
  createArchivalProfile,
  updateArchivalProfile,
  deleteArchivalProfile,
  listSyncProfiles,
  getSyncProfile,
  createSyncProfile,
  updateSyncProfile,
  deleteSyncProfile,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listTags,
  createTag,
  deleteTag,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  setCollectionRepositories,
  listJobs,
  getJob,
  pauseJob,
  resumeJob,
  cancelJob,
  retryJob,
  listPools,
  listStoragePathCandidates,
  createPool,
  updatePool,
  migrateRepository,
  listCredentials,
  createCredential,
  deleteCredential,
  getSettings,
  updateSettings,
  rebuildCatalog,
  importLocalArchive,
  backupSqlite,
  getInventory,
  getPhase3Settings,
  patchPhase3Settings,
  listBackups,
  runBackup,
  getSelfPreservationReport,
  listRepositorySnapshots,
  createRepositorySnapshot,
  getExport,
  exportDownloadUrl,
  globalSearch,
  getCloneUrls,
  getAuthSession,
  login,
  logout,
  getSearchIndex,
  patchSearchIndex,
  rebuildSearchIndex,
  pauseSearchIndex,
  resumeSearchIndex,
  deleteSearchIndex,
  listSshKeys,
  addSshKey,
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
};
