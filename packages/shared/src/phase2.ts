export const SEARCH_CAPABILITIES = ['metadata', 'filenames', 'source_text'] as const;
export type SearchCapability = (typeof SEARCH_CAPABILITIES)[number];

export const AUTH_MODES = ['trusted', 'local', 'oidc'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const INDEX_JOB_STATES = ['disabled', 'idle', 'queued', 'running', 'paused', 'error'] as const;
export type IndexJobState = (typeof INDEX_JOB_STATES)[number];

export interface SearchIndexConfig {
  metadata: boolean;
  filenames: boolean;
  sourceText: boolean;
  maxFileBytes: number;
  excludeGlobs: string[];
}

export const DEFAULT_SEARCH_INDEX: SearchIndexConfig = {
  metadata: true,
  filenames: false,
  sourceText: false,
  maxFileBytes: 256 * 1024,
  excludeGlobs: ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.zip', '*.gz', '*.jar', '*.wasm', '*.pdf', '*.exe', '*.dll', '*.so', '*.o', '*.a'],
};

export interface GitAccessSettings {
  httpEnabled: boolean;
  sshEnabled: boolean;
  publicBaseUrl: string | null;
  sshHost: string | null;
  sshPort: number;
  advertiseArchiveRefs: boolean;
}

export interface AuthSettings {
  mode: AuthMode;
  sessionTtlHours: number;
  requireHttpsForLogin: boolean;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  bootstrapCompleted: boolean;
}

export interface NotificationSettings {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

export interface SearchSettings {
  defaultIndex: SearchIndexConfig;
  globalIndexingEnabled: boolean;
  indexDiskBudgetBytes: number | null;
}

export type AccessTokenScope = 'api' | 'git_push' | 'git_fetch';

export interface AccessTokenSummary {
  id: string;
  label: string;
  hint: string;
  scopes: AccessTokenScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SshKeySummary {
  id: string;
  label: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WorkingRepositorySummary {
  id: string;
  name: string;
  archiveRepositoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchIndexStatus {
  repositoryId: string;
  state: IndexJobState;
  enabled: SearchIndexConfig;
  fileCount: number;
  sourceTextBytes: number;
  lastIndexedAt: string | null;
  lastError: string | null;
}

export interface GlobalSearchHit {
  repositoryId: string;
  displayName: string;
  kind: 'metadata' | 'filename' | 'source';
  path: string | null;
  snippet: string | null;
  score: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
