export const COMPONENT_KEYS = [
  'git',
  'pullRefs',
  'metadata',
  'releases',
  'releaseAssets',
  'issues',
  'issueComments',
  'pullRequests',
  'pullRequestComments',
  'discussions',
  'wiki',
  'docs',
  'lfs',
  'submodules',
] as const;

export type ComponentKey = (typeof COMPONENT_KEYS)[number];

const COMPONENT_KEY_SET: ReadonlySet<string> = new Set(COMPONENT_KEYS);

export function isComponentKey(value: string): value is ComponentKey {
  return COMPONENT_KEY_SET.has(value);
}

export const COMPONENT_STATES = [
  'pending',
  'running',
  'complete',
  'partial',
  'failed',
  'unsupported',
  'skipped',
  'paused',
] as const;

export type ComponentState = (typeof COMPONENT_STATES)[number];

export const ARCHIVE_STATUSES = [
  'pending',
  'queued',
  'running',
  'healthy',
  'partial',
  'unavailable',
  'corrupt',
  'deleted',
] as const;

export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const JOB_STATES = [
  'queued',
  'running',
  'paused',
  'partial',
  'completed',
  'failed',
  'cancelled',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const HEALTH_STATES = ['unknown', 'ok', 'warning', 'corrupt'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const UPSTREAM_STATUSES = [
  'unknown',
  'reachable',
  'unavailable',
  'not_found',
  'auth_required',
] as const;
export type UpstreamStatus = (typeof UPSTREAM_STATUSES)[number];

export const PROVIDERS = ['github', 'gitlab', 'git'] as const;
export type ProviderKind = (typeof PROVIDERS)[number];

export const JOB_TYPES = ['sync', 'verify', 'export', 'migrate', 'import', 'rebuild', 'index'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const EXPORT_FORMATS = ['bundle', 'directory', 'package'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ComponentSnapshot {
  component: ComponentKey;
  state: ComponentState;
  sizeBytes: number;
  lastSuccessAt: string | null;
  error: string | null;
}
