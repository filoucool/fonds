import type { ArchiveStatus, ComponentKey, JobState, PlacementMode, Provider } from '../api/types';

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
] as const satisfies readonly ComponentKey[];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  git: 'Git',
  pullRefs: 'Pull refs',
  metadata: 'Metadata',
  releases: 'Releases',
  releaseAssets: 'Release assets',
  issues: 'Issues',
  issueComments: 'Issue comments',
  pullRequests: 'Pull requests',
  pullRequestComments: 'Pull request comments',
  discussions: 'Discussions',
  wiki: 'Wiki',
  docs: 'Docs',
  lfs: 'LFS',
  submodules: 'Submodules',
};

export const ARCHIVE_STATUSES: ArchiveStatus[] = [
  'pending',
  'queued',
  'running',
  'healthy',
  'partial',
  'unavailable',
  'corrupt',
  'deleted',
];

export const JOB_STATES: JobState[] = [
  'queued',
  'running',
  'paused',
  'partial',
  'completed',
  'failed',
  'cancelled',
];

export const PROVIDERS: Provider[] = ['github', 'gitlab', 'git'];

export type Tone =
  | 'neutral'
  | 'info'
  | 'ok'
  | 'warn'
  | 'danger'
  | 'brass'
  | 'skip'
  | 'unsupported';

export function componentLabel(key: string | null | undefined): string {
  if (!key) return 'Step';
  if ((COMPONENT_KEYS as readonly string[]).includes(key)) {
    return COMPONENT_LABELS[key as ComponentKey];
  }
  return key;
}

export function providerLabel(provider: string): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'gitlab') return 'GitLab';
  if (provider === 'git') return 'Git';
  return provider;
}

export function placementLabel(mode: PlacementMode | string): string {
  if (mode === 'most-free') return 'Most free space';
  if (mode === 'default-pool') return 'Default pool';
  if (mode === 'manual') return 'Manual';
  return mode;
}

export function statusText(value: string): string {
  return value.replace(/_/g, ' ');
}

export function jobTypeLabel(type: string): string {
  if (type === 'sync') return 'Sync';
  if (type === 'verify') return 'Verify';
  if (type === 'export') return 'Export';
  if (type === 'migrate') return 'Migrate';
  if (type === 'import') return 'Import';
  if (type === 'rebuild') return 'Rebuild';
  return type;
}

export function toneFor(value: string): Tone {
  switch (value) {
    case 'healthy':
    case 'complete':
    case 'completed':
    case 'ok':
    case 'reachable':
    case 'success':
    case 'passed':
      return 'ok';
    case 'partial':
    case 'warning':
    case 'paused':
    case 'auth_required':
      return 'warn';
    case 'unavailable':
    case 'corrupt':
    case 'failed':
    case 'not_found':
    case 'error':
      return 'danger';
    case 'running':
      return 'brass';
    case 'queued':
    case 'pending':
      return 'info';
    case 'skipped':
      return 'skip';
    case 'unsupported':
      return 'unsupported';
    case 'unknown':
    case 'deleted':
    case 'cancelled':
    case 'canceled':
      return 'neutral';
    default:
      return 'info';
  }
}

export function isJobState(value: string): value is JobState {
  return (JOB_STATES as string[]).includes(value);
}

export function isArchiveStatus(value: string): value is ArchiveStatus {
  return (ARCHIVE_STATUSES as string[]).includes(value);
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as string[]).includes(value);
}
