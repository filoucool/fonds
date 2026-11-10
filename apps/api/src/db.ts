import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  completeProfile,
  DEFAULT_SEARCH_INDEX,
  minimalProfile,
  standardProfile,
  type AppSettings,
} from '@repo-archive/shared';

const MIGRATION = `
CREATE TABLE storage_pools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  free_space_threshold_bytes INTEGER NOT NULL DEFAULT 1073741824,
  accept_new INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  placement_weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE archival_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  schedule_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  paused INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  fetch_url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  provider_repo_id TEXT,
  default_branch TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  archive_status TEXT NOT NULL,
  upstream_status TEXT NOT NULL DEFAULT 'unknown',
  health TEXT NOT NULL DEFAULT 'unknown',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_pool_id TEXT REFERENCES storage_pools(id),
  relative_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  license TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_sync_at TEXT,
  last_success_at TEXT
);

CREATE UNIQUE INDEX idx_repositories_identity_active ON repositories(identity_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_repositories_live_updated ON repositories(updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_repositories_status ON repositories(archive_status, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_repositories_name ON repositories(display_name COLLATE NOCASE, id);
CREATE INDEX idx_repositories_provider ON repositories(provider, updated_at DESC, id);
CREATE INDEX idx_repositories_category ON repositories(category_id);
CREATE INDEX idx_repositories_pool ON repositories(storage_pool_id);

CREATE TABLE repository_sources (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  upstream_status TEXT NOT NULL DEFAULT 'unknown',
  last_contact_at TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sources_url ON repository_sources(url);
CREATE INDEX idx_sources_identity ON repository_sources(identity_key);
CREATE INDEX idx_sources_repo ON repository_sources(repository_id);

CREATE TABLE repository_profile_assignments (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES archival_profiles(id),
  overrides_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE repository_sync_assignments (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  sync_profile_id TEXT NOT NULL REFERENCES sync_profiles(id),
  paused INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  last_run_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sync_due ON repository_sync_assignments(paused, next_run_at);

CREATE TABLE repository_tags (
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (repository_id, tag_id)
);
CREATE INDEX idx_repository_tags_tag ON repository_tags(tag_id);

CREATE TABLE collection_members (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, repository_id)
);

CREATE TABLE archive_components (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  state TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_attempt_at TEXT,
  error TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (repository_id, component)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  error_category TEXT,
  error_message TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  not_before TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX idx_jobs_claim ON jobs(state, priority DESC, created_at ASC);
CREATE INDEX idx_jobs_repo_state ON jobs(repository_id, state);
CREATE INDEX idx_jobs_lease ON jobs(state, lease_expires_at);

CREATE TABLE job_steps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  component TEXT NOT NULL,
  state TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  bytes_done INTEGER NOT NULL DEFAULT 0,
  bytes_total INTEGER,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (job_id, component)
);

CREATE TABLE archive_events (
  id TEXT PRIMARY KEY,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_repo ON archive_events(repository_id, created_at DESC, id DESC);
CREATE INDEX idx_events_time ON archive_events(created_at DESC, id DESC);

CREATE TABLE integrity_runs (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL,
  results_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_integrity_repo ON integrity_runs(repository_id, started_at DESC);

CREATE TABLE archive_manifests (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  reconciliation_status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_records (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  parent_key TEXT,
  number INTEGER,
  title TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  created_at TEXT,
  updated_at TEXT,
  raw_relative_path TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  sync_generation INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repository_id, kind, provider_key)
);
CREATE INDEX idx_provider_records_list ON provider_records(repository_id, kind, number DESC, id DESC);

CREATE TABLE release_assets (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  release_key TEXT NOT NULL,
  name TEXT NOT NULL,
  upstream_url TEXT,
  relative_path TEXT,
  byte_size INTEGER,
  sha256 TEXT,
  state TEXT NOT NULL,
  error TEXT,
  UNIQUE (repository_id, release_key, name)
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  token TEXT NOT NULL,
  hint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  relative_path TEXT,
  byte_size INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
`;

export function openDatabase(filePath: string): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const db = new Database(filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Some network filesystems reject mode changes. The operator still controls the mount.
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${filePath}${suffix}`;
    if (existsSync(sidecar)) {
      try {
        chmodSync(sidecar, 0o600);
      } catch {
        // Ignore filesystems that do not support chmod.
      }
    }
  }
  return db;
}

const MIGRATION_0002 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  totp_secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at DESC);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE ssh_public_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_ssh_keys_user ON ssh_public_keys(user_id);

CREATE TABLE access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_access_tokens_user ON access_tokens(user_id);

CREATE TABLE working_repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  archive_repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE repository_search_index (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'disabled',
  config_json TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  source_text_bytes INTEGER NOT NULL DEFAULT 0,
  last_indexed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_time ON audit_events(created_at DESC, id DESC);

CREATE TABLE notification_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  rule_id TEXT REFERENCES notification_rules(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_notification_pending ON notification_deliveries(status, next_attempt_at);
`;

function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = (id: string) => db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(id);
  if (!applied('0001_init')) {
    const apply = db.transaction(() => {
      db.exec(MIGRATION);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('0001_init', new Date().toISOString());
    });
    apply();
  }
  if (!applied('0002_phase2')) {
    const apply = db.transaction(() => {
      db.exec(MIGRATION_0002);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run('0002_phase2', new Date().toISOString());
    });
    apply();
  }
}

export function defaultSettings(poolId: string): AppSettings {
  return {
    maxConcurrentJobs: 2,
    allowPrivateNetworks: false,
    privateNetworkExceptions: [],
    allowFileUrls: false,
    githubHosts: ['github.com'],
    gitlabHosts: ['gitlab.com'],
    placementMode: 'most-free',
    defaultPoolId: poolId,
    balancingEnabled: false,
    balanceHighWatermarkRatio: 0.9,
    balanceLowWatermarkRatio: 0.7,
    defaultArchivalProfileId: 'profile-standard',
    defaultSyncProfileId: 'sync-manual',
    requestTimeoutMs: 60_000,
    gitTimeoutMs: 60 * 60 * 1000,
    maxAttempts: 3,
    maxProviderPages: 200,
    dashboardWidgets: ['status', 'jobs', 'due', 'attention', 'storage', 'events'],
    auth: {
      mode: 'trusted',
      sessionTtlHours: 168,
      requireHttpsForLogin: false,
      oidcIssuer: null,
      oidcClientId: null,
      bootstrapCompleted: true,
    },
    gitAccess: {
      httpEnabled: true,
      sshEnabled: false,
      publicBaseUrl: null,
      sshHost: null,
      sshPort: 2222,
      advertiseArchiveRefs: true,
    },
    search: {
      defaultIndex: { ...DEFAULT_SEARCH_INDEX },
      globalIndexingEnabled: false,
      indexDiskBudgetBytes: null,
    },
    notifications: {
      inAppEnabled: true,
      emailEnabled: false,
      webhookEnabled: false,
      webhookUrl: null,
      webhookSecret: null,
    },
  };
}

export function seedDatabase(db: Database.Database, dataDir: string): void {
  const now = new Date().toISOString();
  const poolId = 'pool-default';
  const poolRoot = path.join(dataDir, 'pool-1');
  mkdirSync(path.join(poolRoot, 'archives'), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dataDir, 'app', 'backups'), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dataDir, 'exports'), { recursive: true, mode: 0o700 });
  const insertPool = db.prepare(
    `INSERT INTO storage_pools (id, name, root_path, free_space_threshold_bytes, accept_new, enabled, placement_weight, created_at, updated_at)
     SELECT ?, 'default', ?, 1073741824, 1, 1, 1, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM storage_pools)`,
  );
  insertPool.run(poolId, poolRoot, now, now);
  const profiles: { id: string; name: string; description: string; config: unknown }[] = [
    { id: 'profile-minimal', name: 'Minimal', description: 'Git history and provider metadata only.', config: minimalProfile() },
    { id: 'profile-standard', name: 'Standard', description: 'Git history, metadata, docs, and releases.', config: standardProfile() },
    { id: 'profile-complete', name: 'Complete', description: 'Every component the provider can supply.', config: completeProfile() },
  ];
  const insertProfile = db.prepare(
    `INSERT INTO archival_profiles (id, name, description, config_json, is_builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const profile of profiles) {
    insertProfile.run(profile.id, profile.name, profile.description, JSON.stringify(profile.config), now, now);
  }
  const insertSync = db.prepare(
    `INSERT INTO sync_profiles (id, name, description, schedule_json, timezone, paused, is_builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  insertSync.run('sync-manual', 'Manual', 'Synchronize only when requested.', JSON.stringify({ kind: 'manual' }), 'UTC', 0, now, now);
  insertSync.run(
    'sync-weekly',
    'Weekly',
    'Synchronize every Monday at 02:00.',
    JSON.stringify({ kind: 'weekly', weekday: 1, hour: 2, minute: 0 }),
    'UTC',
    0,
    now,
    now,
  );
  const settings = defaultSettings(poolId);
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES ('app', ?, ?)
     ON CONFLICT(key) DO NOTHING`,
  ).run(JSON.stringify(settings), now);
}
