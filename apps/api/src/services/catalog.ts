import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  archivePaths,
  archiveRelativePath,
  emptyComponents,
  readManifest,
  sanitizeFileName,
  writeChecksums,
  writeManifest,
  type ArchiveManifest,
  type ManifestArchivedRef,
  type ManifestRef,
} from '@repo-archive/archive-format';
import {
  COMPONENT_KEYS,
  computeNextRun,
  decodeCursor,
  encodeCursor,
  isComponentKey,
  isProfileConfig,
  isRecord,
  isSchedule,
  isValidTimeZone,
  parseJson,
  parseRepositoryUrl,
  resolveProfile,
  type ArchivalProfileConfig,
  type ArchivalProfileView,
  type ArchiveEvent,
  type ArchiveStatus,
  type Category,
  type Collection,
  type ComponentKey,
  type ComponentSnapshot,
  type ComponentState,
  type CredentialSummary,
  type Dashboard,
  type ExportFormat,
  type Page,
  type ProfileOverrides,
  type ProviderKind,
  type ReleaseView,
  type RepositoryDetail,
  type RepositorySummary,
  type SyncProfileView,
  type Tag,
  type TextRecord,
} from '@repo-archive/shared';
import { assertRemotePermitted, type NetworkPolicy } from '@repo-archive/shared/policy';
import { UrlRejectedError } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { asRow, asRows, flag, id, integer, integerOrNull, jsonRecord, nowIso, text, textOrNull } from '../rows';
import type { JobsService } from './jobs';
import type { SettingsService } from './settings';
import type { StorageService } from './storage';

export interface RepoRecord {
  id: string;
  identityKey: string;
  canonicalUrl: string;
  fetchUrl: string;
  displayName: string;
  description: string;
  provider: ProviderKind;
  providerRepoId: string | null;
  defaultBranch: string | null;
  categoryId: string | null;
  archiveStatus: string;
  upstreamStatus: string;
  health: string;
  sizeBytes: number;
  storagePoolId: string;
  relativePath: string;
  metadata: Record<string, unknown>;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
}

export class CatalogService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  list(query: ListQuery): Page<RepositorySummary> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const sort = query.sort ?? 'updated';
    const cursor = query.cursor ? decodeListCursor(query.cursor, sort) : null;
    const includeDeleted = query.includeDeleted === true || query.status === 'deleted';
    const like = query.q ? `%${escapeLike(query.q)}%` : null;
    const keyset = cursor
      ? sort === 'name'
        ? [cursor.k, cursor.k, cursor.id]
        : sort === 'size'
          ? [Number(cursor.k), Number(cursor.k), cursor.id]
          : [cursor.k, cursor.k, cursor.id]
      : [null, null, null];
    const comparison =
      sort === 'name'
        ? `(? IS NULL OR display_name > ? COLLATE NOCASE OR (display_name = ? COLLATE NOCASE AND id > ?))`
        : sort === 'size'
          ? `(? IS NULL OR size_bytes < ? OR (size_bytes = ? AND id < ?))`
          : `(? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))`;
    const order =
      sort === 'name' ? 'display_name COLLATE NOCASE ASC, id ASC' : sort === 'size' ? 'size_bytes DESC, id DESC' : 'updated_at DESC, id DESC';
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT * FROM repositories
           WHERE (? = 1 OR deleted_at IS NULL)
             AND (? IS NULL OR archive_status = ?)
             AND (? IS NULL OR provider = ?)
             AND (? IS NULL OR category_id = ?)
             AND (? IS NULL OR id IN (SELECT repository_id FROM repository_tags WHERE tag_id = ?))
             AND (? IS NULL OR id IN (SELECT repository_id FROM collection_members WHERE collection_id = ?))
             AND (? IS NULL OR display_name LIKE ? ESCAPE '!' OR canonical_url LIKE ? ESCAPE '!')
             AND ${comparison}
           ORDER BY ${order}
           LIMIT ?`,
        )
        .all(
          includeDeleted ? 1 : 0,
          query.status ?? null,
          query.status ?? null,
          query.provider ?? null,
          query.provider ?? null,
          query.categoryId ?? null,
          query.categoryId ?? null,
          query.tagId ?? null,
          query.tagId ?? null,
          query.collectionId ?? null,
          query.collectionId ?? null,
          like,
          like,
          like,
          cursor ? '1' : null,
          ...keyset,
          limit + 1,
        ),
    );
    const page = rows.slice(0, limit).map((row) => this.summary(mapRepo(row)));
    const extra = rows[limit];
    const next = extra
      ? encodeCursor({
          s: sort,
          k: sort === 'size' ? String(integer(extra, 'size_bytes')) : sort === 'name' ? text(extra, 'display_name') : text(extra, 'updated_at'),
          id: text(extra, 'id'),
        })
      : null;
    return { items: page, nextCursor: next };
  }

  get(repositoryId: string): RepositoryDetail {
    return this.detail(this.require(repositoryId));
  }

  async create(input: { url: string; displayName?: string; profileId?: string; syncProfileId?: string; categoryId?: string; tagIds?: string[] }): Promise<{ repository: RepositoryDetail; jobId: string }> {
    const settings = this.settings.get();
    const parsed = parseRepositoryUrl(input.url, { githubHosts: settings.githubHosts, gitlabHosts: settings.gitlabHosts });
    if (!parsed.discardedCredentials) {
      await this.permit(parsed.fetchUrl);
    } else {
      await this.permit(parsed.fetchUrl);
    }
    const existing = this.findByIdentity(parsed.identityKey, parsed.canonicalUrl, parsed.fetchUrl);
    if (existing && !existing.deletedAt) throw new HttpError(409, 'repository already exists', { existingId: existing.id });
    if (existing?.deletedAt) {
      this.restore(existing.id);
      const jobId = this.enqueueSync(existing.id);
      return { repository: this.get(existing.id), jobId };
    }
    const pool = this.storage.chooseForNew();
    const repositoryId = id();
    const now = nowIso();
    const profileId = input.profileId ?? settings.defaultArchivalProfileId ?? 'profile-standard';
    const syncProfileId = input.syncProfileId ?? settings.defaultSyncProfileId ?? 'sync-manual';
    this.requireProfile(profileId);
    const syncProfile = this.requireSyncProfile(syncProfileId);
    const relativePath = archiveRelativePath(repositoryId);
    const displayName = input.displayName?.trim() || parsed.name;
    const create = this.sqlite.transaction(() => {
      this.sqlite
        .prepare(
          `INSERT INTO repositories (
             id, identity_key, canonical_url, fetch_url, display_name, description, provider, archive_status, upstream_status,
             health, size_bytes, storage_pool_id, relative_path, metadata_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, '', ?, 'queued', 'unknown', 'unknown', 0, ?, ?, '{}', ?, ?)`,
        )
        .run(repositoryId, parsed.identityKey, parsed.canonicalUrl, parsed.fetchUrl, displayName, parsed.provider, pool.id, relativePath, now, now);
      this.insertSource(repositoryId, parsed.canonicalUrl, parsed.identityKey, 'canonical', now);
      if (parsed.fetchUrl !== parsed.canonicalUrl) this.insertSource(repositoryId, parsed.fetchUrl, parsed.identityKey, 'fetch', now);
      this.sqlite
        .prepare(`INSERT INTO repository_profile_assignments (repository_id, profile_id, overrides_json, updated_at) VALUES (?, ?, '{}', ?)`)
        .run(repositoryId, profileId, now);
      const nextRun = syncProfile.schedule.kind === 'manual' ? null : computeNextRun(syncProfile.schedule, syncProfile.timezone, new Date())?.toISOString() ?? null;
      this.sqlite
        .prepare(
          `INSERT INTO repository_sync_assignments (repository_id, sync_profile_id, paused, next_run_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
        )
        .run(repositoryId, syncProfileId, nextRun, now);
      if (input.categoryId) this.sqlite.prepare(`UPDATE repositories SET category_id = ? WHERE id = ?`).run(input.categoryId, repositoryId);
      for (const tagId of input.tagIds ?? []) {
        this.sqlite.prepare(`INSERT OR IGNORE INTO repository_tags (repository_id, tag_id) VALUES (?, ?)`).run(repositoryId, tagId);
      }
      const profile = this.profileConfig(profileId);
      for (const key of COMPONENT_KEYS) {
        const state = profile.components[key] ? 'pending' : 'skipped';
        this.sqlite
          .prepare(
            `INSERT INTO archive_components (id, repository_id, component, state, size_bytes, detail_json) VALUES (?, ?, ?, ?, 0, '{}')`,
          )
          .run(id(), repositoryId, key, state);
      }
      this.event(repositoryId, 'repository.created', `Archived ${displayName}`, { url: parsed.canonicalUrl, discardedCredentials: parsed.discardedCredentials });
    });
    create();
    await mkdir(archivePaths(pool.rootPath, repositoryId).root, { recursive: true });
    const jobId = this.enqueueSync(repositoryId);
    return { repository: this.get(repositoryId), jobId };
  }

  importText(input: { text: string; format: 'text' | 'csv'; profileId?: string; syncProfileId?: string; categoryId?: string }) {
    const lines = input.format === 'csv' ? csvUrls(input.text) : textUrls(input.text);
    const created: { id: string; url: string; jobId: string }[] = [];
    const duplicates: { url: string; existingId: string }[] = [];
    const invalid: { line: number; url: string; error: string }[] = [];
    return (async () => {
      for (const line of lines) {
        try {
          const result = await this.create({
            url: line.url,
            displayName: line.name,
            profileId: input.profileId,
            syncProfileId: input.syncProfileId,
            categoryId: line.categoryId ?? input.categoryId,
            tagIds: line.tagIds,
          });
          created.push({ id: result.repository.id, url: line.url, jobId: result.jobId });
        } catch (error) {
          if (error instanceof HttpError && error.status === 409 && typeof error.details.existingId === 'string') {
            duplicates.push({ url: line.url, existingId: error.details.existingId });
          } else {
            invalid.push({ line: line.line, url: line.url, error: error instanceof Error ? error.message : 'invalid row' });
          }
        }
      }
      return { created, duplicates, invalid };
    })();
  }

  update(repositoryId: string, patch: Record<string, unknown>): RepositoryDetail {
    const repo = this.require(repositoryId);
    const now = nowIso();
    if (typeof patch.displayName === 'string') {
      this.sqlite.prepare(`UPDATE repositories SET display_name = ?, updated_at = ? WHERE id = ?`).run(patch.displayName.trim(), now, repositoryId);
    }
    if (typeof patch.description === 'string') {
      this.sqlite.prepare(`UPDATE repositories SET description = ?, updated_at = ? WHERE id = ?`).run(patch.description, now, repositoryId);
    }
    if ('categoryId' in patch) {
      this.sqlite.prepare(`UPDATE repositories SET category_id = ?, updated_at = ? WHERE id = ?`).run(patch.categoryId ?? null, now, repositoryId);
    }
    if (Array.isArray(patch.tagIds)) {
      this.sqlite.prepare(`DELETE FROM repository_tags WHERE repository_id = ?`).run(repositoryId);
      for (const tagId of patch.tagIds) {
        if (typeof tagId === 'string') this.sqlite.prepare(`INSERT OR IGNORE INTO repository_tags (repository_id, tag_id) VALUES (?, ?)`).run(repositoryId, tagId);
      }
    }
    if (typeof patch.profileId === 'string') {
      this.requireProfile(patch.profileId);
      this.sqlite.prepare(`UPDATE repository_profile_assignments SET profile_id = ?, updated_at = ? WHERE repository_id = ?`).run(patch.profileId, now, repositoryId);
    }
    if (typeof patch.syncProfileId === 'string') {
      const profile = this.requireSyncProfile(patch.syncProfileId);
      const next = profile.schedule.kind === 'manual' ? null : computeNextRun(profile.schedule, profile.timezone, new Date())?.toISOString() ?? null;
      this.sqlite
        .prepare(`UPDATE repository_sync_assignments SET sync_profile_id = ?, next_run_at = ?, updated_at = ? WHERE repository_id = ?`)
        .run(patch.syncProfileId, next, now, repositoryId);
    }
    if (typeof patch.syncPaused === 'boolean') {
      this.sqlite.prepare(`UPDATE repository_sync_assignments SET paused = ?, updated_at = ? WHERE repository_id = ?`).run(patch.syncPaused ? 1 : 0, now, repositoryId);
    }
    if (isRecord(patch.overrides)) {
      this.sqlite.prepare(`UPDATE repository_profile_assignments SET overrides_json = ?, updated_at = ? WHERE repository_id = ?`).run(JSON.stringify(readOverrides(patch.overrides)), now, repositoryId);
    }
    this.event(repo.id, 'repository.updated', `Updated ${repo.displayName}`, {});
    return this.get(repositoryId);
  }

  softDelete(ids: string[], confirm: boolean): string[] {
    if (!confirm) throw new HttpError(400, 'delete requires confirm: true');
    const now = nowIso();
    const deleted: string[] = [];
    for (const repositoryId of ids) {
      const result = this.sqlite
        .prepare(`UPDATE repositories SET deleted_at = ?, archive_status = 'deleted', updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
        .run(now, now, repositoryId);
      if (result.changes === 1) {
        deleted.push(repositoryId);
        this.event(repositoryId, 'repository.deleted', 'Soft-deleted repository', {});
      }
    }
    return deleted;
  }

  restore(repositoryId: string): RepositoryDetail {
    this.sqlite.prepare(`UPDATE repositories SET deleted_at = NULL, archive_status = 'queued', updated_at = ? WHERE id = ?`).run(nowIso(), repositoryId);
    this.event(repositoryId, 'repository.restored', 'Restored repository', {});
    return this.get(repositoryId);
  }

  async purge(repositoryId: string, confirmName: string): Promise<void> {
    const repo = this.require(repositoryId);
    if (confirmName !== repo.displayName) throw new HttpError(400, 'confirmation name does not match');
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    await rm(located.paths.root, { recursive: true, force: true });
    this.sqlite.prepare(`DELETE FROM repositories WHERE id = ?`).run(repositoryId);
  }

  enqueueSync(repositoryId: string): string {
    const settings = this.settings.get();
    const jobId = this.jobs.enqueue({ repositoryId, type: 'sync', maxAttempts: settings.maxAttempts, priority: 10 });
    this.sqlite.prepare(`UPDATE repositories SET archive_status = 'queued', updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(nowIso(), repositoryId);
    return jobId;
  }

  enqueueTyped(repositoryId: string, type: 'verify' | 'export' | 'migrate' | 'import' | 'index', payload: Record<string, unknown>): string {
    return this.jobs.enqueue({ repositoryId, type, payload, maxAttempts: this.settings.get().maxAttempts });
  }

  require(repositoryId: string): RepoRecord {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM repositories WHERE id = ?`).get(repositoryId));
    if (!row) throw new HttpError(404, 'repository not found');
    return mapRepo(row);
  }

  effectiveProfile(repositoryId: string): { id: string; name: string; config: ArchivalProfileConfig; overrides: ProfileOverrides } {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT archival_profiles.id, archival_profiles.name, archival_profiles.config_json, repository_profile_assignments.overrides_json
           FROM repository_profile_assignments
           JOIN archival_profiles ON archival_profiles.id = repository_profile_assignments.profile_id
           WHERE repository_profile_assignments.repository_id = ?`,
        )
        .get(repositoryId),
    );
    if (!row) throw new HttpError(404, 'profile assignment not found');
    const config = parseJson(text(row, 'config_json'));
    if (!isProfileConfig(config)) throw new Error('stored profile is invalid');
    const overrides = readOverrides(parseJson(text(row, 'overrides_json')));
    return { id: text(row, 'id'), name: text(row, 'name'), config: resolveProfile(config, overrides), overrides };
  }

  setComponent(repositoryId: string, component: ComponentKey, patch: { state: ComponentState; sizeBytes?: number; error?: string | null; detail?: Record<string, unknown>; success?: boolean }): void {
    const now = nowIso();
    this.sqlite
      .prepare(
        `UPDATE archive_components
         SET state = ?, size_bytes = COALESCE(?, size_bytes), error = ?, detail_json = COALESCE(?, detail_json),
             last_attempt_at = ?, last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END
         WHERE repository_id = ? AND component = ?`,
      )
      .run(
        patch.state,
        patch.sizeBytes ?? null,
        patch.error === undefined ? null : patch.error,
        patch.detail ? JSON.stringify(patch.detail) : null,
        now,
        patch.success ? 1 : 0,
        now,
        repositoryId,
        component,
      );
  }

  components(repositoryId: string): ComponentSnapshot[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM archive_components WHERE repository_id = ? ORDER BY component ASC`).all(repositoryId)).map(mapComponent);
  }

  recompute(repositoryId: string): void {
    const repo = this.require(repositoryId);
    if (repo.deletedAt) return;
    const components = this.components(repositoryId);
    const status = rollup(components, repo.health);
    this.sqlite.prepare(`UPDATE repositories SET archive_status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), repositoryId);
  }

  setUpstream(repositoryId: string, status: string): void {
    this.sqlite.prepare(`UPDATE repositories SET upstream_status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), repositoryId);
  }

  markSynced(repositoryId: string, success: boolean): void {
    const now = nowIso();
    this.sqlite
      .prepare(`UPDATE repositories SET last_sync_at = ?, last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END, updated_at = ? WHERE id = ?`)
      .run(now, success ? 1 : 0, now, now, repositoryId);
    const assignment = asRow(this.sqlite.prepare(`SELECT sync_profiles.schedule_json, sync_profiles.timezone FROM repository_sync_assignments JOIN sync_profiles ON sync_profiles.id = repository_sync_assignments.sync_profile_id WHERE repository_id = ?`).get(repositoryId));
    if (!assignment) return;
    const schedule = parseJson(text(assignment, 'schedule_json'));
    if (!isSchedule(schedule)) return;
    const next = computeNextRun(schedule, text(assignment, 'timezone'), new Date());
    this.sqlite.prepare(`UPDATE repository_sync_assignments SET last_run_at = ?, next_run_at = ? WHERE repository_id = ?`).run(now, next?.toISOString() ?? null, repositoryId);
  }

  async saveManifest(repo: RepoRecord, refs: { current: ManifestRef[]; archived: ManifestArchivedRef[] }): Promise<void> {
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const profile = this.effectiveProfile(repo.id);
    const previous = await readManifest(located.paths.manifest).catch(() => null);
    const archived = mergeArchived(previous?.refs.archived ?? [], refs.archived);
    const aliases = asRows(this.sqlite.prepare(`SELECT url FROM repository_sources WHERE repository_id = ? AND kind != 'canonical'`).all(repo.id)).map((row) => text(row, 'url'));
    const components = emptyComponents();
    for (const component of this.components(repo.id)) {
      components[component.component] = {
        state: component.state,
        sizeBytes: component.sizeBytes,
        lastSuccessAt: component.lastSuccessAt,
        error: component.error,
      };
    }
    const base: Omit<ArchiveManifest, 'contentHash'> = {
      schemaVersion: 1,
      id: repo.id,
      createdAt: previous?.createdAt ?? repo.createdAt,
      updatedAt: nowIso(),
      generation: (previous?.generation ?? 0) + 1,
      source: {
        canonicalUrl: repo.canonicalUrl,
        identityKey: repo.identityKey,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        aliases,
        defaultBranch: repo.defaultBranch,
      },
      displayName: repo.displayName,
      description: repo.description,
      license: repo.license,
      profile: { name: profile.name, components: profile.config.components },
      components,
      refs: { current: refs.current, archived },
      storage: { relativeLayout: 'v1' },
    };
    const written = await writeManifest(located.paths.manifest, { ...base, contentHash: '' });
    await writeChecksums(located.paths.root, written.updatedAt);
    this.sqlite
      .prepare(
        `INSERT INTO archive_manifests (repository_id, schema_version, generation, content_hash, reconciliation_status, updated_at)
         VALUES (?, ?, ?, ?, 'current', ?)
         ON CONFLICT(repository_id) DO UPDATE SET schema_version = excluded.schema_version, generation = excluded.generation, content_hash = excluded.content_hash, reconciliation_status = 'current', updated_at = excluded.updated_at`,
      )
      .run(repo.id, written.schemaVersion, written.generation, written.contentHash, written.updatedAt);
  }

  applyMetadata(repositoryId: string, metadata: { providerRepoId: string | null; displayName: string; description: string; defaultBranch: string | null; license: string | null; raw: unknown }): void {
    this.sqlite
      .prepare(
        `UPDATE repositories
         SET provider_repo_id = COALESCE(?, provider_repo_id), description = ?, default_branch = COALESCE(?, default_branch),
             license = ?, metadata_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(metadata.providerRepoId, metadata.description, metadata.defaultBranch, metadata.license, JSON.stringify(metadata.raw ?? {}), nowIso(), repositoryId);
  }

  credentialFor(provider: ProviderKind): { id: string; token: string; username: string } | null {
    const row = asRow(this.sqlite.prepare(`SELECT id, token FROM credentials WHERE provider = ? ORDER BY created_at DESC LIMIT 1`).get(provider));
    if (!row) return null;
    const username = provider === 'github' ? 'x-access-token' : provider === 'gitlab' ? 'oauth2' : 'git';
    return { id: text(row, 'id'), token: text(row, 'token'), username };
  }

  upsertRecord(input: {
    repositoryId: string;
    kind: string;
    providerKey: string;
    parentKey?: string | null;
    number?: number | null;
    title: string;
    state: string;
    author: string;
    body: string;
    url?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    rawRelativePath?: string | null;
    extra?: Record<string, unknown>;
    generation: number;
  }): void {
    this.sqlite
      .prepare(
        `INSERT INTO provider_records (
           id, repository_id, kind, provider_key, parent_key, number, title, state, author, body, url, created_at, updated_at, raw_relative_path, extra_json, sync_generation
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id, kind, provider_key) DO UPDATE SET
           parent_key = excluded.parent_key, number = excluded.number, title = excluded.title, state = excluded.state,
           author = excluded.author, body = excluded.body, url = excluded.url, created_at = excluded.created_at,
           updated_at = excluded.updated_at, raw_relative_path = excluded.raw_relative_path, extra_json = excluded.extra_json,
           sync_generation = excluded.sync_generation`,
      )
      .run(
        id(),
        input.repositoryId,
        input.kind,
        input.providerKey,
        input.parentKey ?? null,
        input.number ?? null,
        input.title,
        input.state,
        input.author,
        input.body,
        input.url ?? null,
        input.createdAt ?? null,
        input.updatedAt ?? null,
        input.rawRelativePath ?? null,
        JSON.stringify(input.extra ?? {}),
        input.generation,
      );
  }

  async lfsObjects(repositoryId: string): Promise<{ path: string; oid: string; size: number }[]> {
    const repo = this.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    try {
      const parsed = parseJson(await readFile(path.join(located.paths.lfs, 'index.json'), 'utf8'));
      if (!isRecord(parsed) || !Array.isArray(parsed.objects)) return [];
      return parsed.objects.filter(isLfsObject);
    } catch {
      return [];
    }
  }

  children(repositoryId: string, kind: string, parentKeys: string[]): TextRecord[] {
    if (parentKeys.length === 0) return [];
    const placeholders = parentKeys.map(() => '?').join(', ');
    return asRows(
      this.sqlite
        .prepare(`SELECT * FROM provider_records WHERE repository_id = ? AND kind = ? AND parent_key IN (${placeholders}) ORDER BY number ASC`)
        .all(repositoryId, kind, ...parentKeys),
    ).map(mapTextRecord);
  }

  savedAsset(repositoryId: string, releaseKey: string, name: string): { state: string; relativePath: string | null; byteSize: number | null } | null {
    const row = asRow(
      this.sqlite.prepare(`SELECT state, relative_path, byte_size FROM release_assets WHERE repository_id = ? AND release_key = ? AND name = ?`).get(repositoryId, releaseKey, sanitizeFileName(name)),
    );
    if (!row) return null;
    return { state: text(row, 'state'), relativePath: textOrNull(row, 'relative_path'), byteSize: integerOrNull(row, 'byte_size') };
  }

  recordKeys(repositoryId: string, kind: string): { key: string; number: number | null }[] {
    return asRows(this.sqlite.prepare(`SELECT provider_key, number FROM provider_records WHERE repository_id = ? AND kind = ? ORDER BY number ASC`).all(repositoryId, kind)).map((row) => ({
      key: text(row, 'provider_key'),
      number: integerOrNull(row, 'number'),
    }));
  }

  markMissing(repositoryId: string, kind: string, generation: number): void {
    const rows = asRows(this.sqlite.prepare(`SELECT id, extra_json, sync_generation FROM provider_records WHERE repository_id = ? AND kind = ?`).all(repositoryId, kind));
    const update = this.sqlite.prepare(`UPDATE provider_records SET extra_json = ? WHERE id = ?`);
    for (const row of rows) {
      if (integer(row, 'sync_generation') === generation) continue;
      const extra = jsonRecord(text(row, 'extra_json'));
      extra.upstreamMissing = true;
      update.run(JSON.stringify(extra), text(row, 'id'));
    }
  }

  upsertAsset(input: { repositoryId: string; releaseKey: string; name: string; upstreamUrl: string | null; relativePath: string | null; byteSize: number | null; sha256: string | null; state: string; error: string | null }): void {
    const safeName = sanitizeFileName(input.name);
    this.sqlite
      .prepare(
        `INSERT INTO release_assets (id, repository_id, release_key, name, upstream_url, relative_path, byte_size, sha256, state, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id, release_key, name) DO UPDATE SET
           upstream_url = excluded.upstream_url, relative_path = excluded.relative_path, byte_size = excluded.byte_size,
           sha256 = excluded.sha256, state = excluded.state, error = excluded.error`,
      )
      .run(id(), input.repositoryId, input.releaseKey, safeName, input.upstreamUrl, input.relativePath, input.byteSize, input.sha256, input.state, input.error);
  }

  event(repositoryId: string | null, kind: string, message: string, detail: Record<string, unknown>): void {
    this.sqlite.prepare(`INSERT INTO archive_events (id, repository_id, kind, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id(), repositoryId, kind, message, JSON.stringify(detail), nowIso());
  }

  events(repositoryId: string, cursor: string | null, limit: number): Page<ArchiveEvent> {
    const decoded = cursor ? decodePair(cursor) : null;
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT archive_events.*, repositories.display_name AS repository_name
           FROM archive_events LEFT JOIN repositories ON repositories.id = archive_events.repository_id
           WHERE archive_events.repository_id = ?
             AND (? IS NULL OR archive_events.created_at < ? OR (archive_events.created_at = ? AND archive_events.id < ?))
           ORDER BY archive_events.created_at DESC, archive_events.id DESC LIMIT ?`,
        )
        .all(repositoryId, decoded ? '1' : null, decoded?.k ?? null, decoded?.k ?? null, decoded?.id ?? null, limit + 1),
    );
    return pageEvents(rows, limit);
  }

  records(repositoryId: string, kind: string, cursor: string | null, limit: number): Page<TextRecord> {
    const decoded = cursor ? decodePair(cursor) : null;
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT * FROM provider_records
           WHERE repository_id = ? AND kind = ?
             AND (? IS NULL OR COALESCE(number, 0) < ? OR (COALESCE(number, 0) = ? AND id < ?))
           ORDER BY COALESCE(number, 0) DESC, id DESC LIMIT ?`,
        )
        .all(repositoryId, kind, decoded ? '1' : null, decoded ? Number(decoded.k) : null, decoded ? Number(decoded.k) : null, decoded?.id ?? null, limit + 1),
    );
    const items = rows.slice(0, limit).map(mapTextRecord);
    const extra = rows[limit];
    return { items, nextCursor: extra ? encodeCursor({ k: String(integerOrNull(extra, 'number') ?? 0), id: text(extra, 'id') }) : null };
  }

  releases(repositoryId: string): ReleaseView[] {
    const rows = asRows(this.sqlite.prepare(`SELECT * FROM provider_records WHERE repository_id = ? AND kind = 'release' ORDER BY created_at DESC`).all(repositoryId));
    return rows.map((row) => {
      const assets = asRows(this.sqlite.prepare(`SELECT * FROM release_assets WHERE repository_id = ? AND release_key = ?`).all(repositoryId, text(row, 'provider_key'))).map((asset) => ({
        id: text(asset, 'id'),
        name: text(asset, 'name'),
        byteSize: integerOrNull(asset, 'byte_size'),
        sha256: textOrNull(asset, 'sha256'),
        state: text(asset, 'state'),
        error: textOrNull(asset, 'error'),
      }));
      return {
        id: text(row, 'id'),
        tag: text(row, 'title'),
        title: text(row, 'title'),
        body: text(row, 'body').slice(0, 20_000),
        state: text(row, 'state'),
        author: text(row, 'author'),
        createdAt: textOrNull(row, 'created_at'),
        url: textOrNull(row, 'url'),
        upstreamMissing: jsonRecord(text(row, 'extra_json')).upstreamMissing === true,
        assets,
      };
    });
  }

  assetFile(repositoryId: string, assetId: string): { absolute: string; name: string } {
    const repo = this.require(repositoryId);
    const row = asRow(this.sqlite.prepare(`SELECT * FROM release_assets WHERE id = ? AND repository_id = ?`).get(assetId, repositoryId));
    if (!row || !textOrNull(row, 'relative_path')) throw new HttpError(404, 'asset not found');
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const relative = text(row, 'relative_path');
    return { absolute: path.join(located.paths.root, ...relative.split('/')), name: text(row, 'name') };
  }

  async directorySize(repositoryId: string): Promise<number> {
    const repo = this.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const size = await walkSize(located.paths.root);
    this.sqlite.prepare(`UPDATE repositories SET size_bytes = ?, updated_at = ? WHERE id = ?`).run(size, nowIso(), repositoryId);
    return size;
  }

  profiles(): ArchivalProfileView[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM archival_profiles ORDER BY name ASC`).all()).map(mapProfile);
  }

  createProfile(input: { name: string; description?: string; config: unknown }): ArchivalProfileView {
    if (!isProfileConfig(input.config)) throw new HttpError(400, 'profile config is invalid');
    const profileId = id();
    const now = nowIso();
    this.sqlite.prepare(`INSERT INTO archival_profiles (id, name, description, config_json, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`).run(profileId, input.name, input.description ?? '', JSON.stringify(input.config), now, now);
    return this.profile(profileId);
  }

  updateProfile(profileId: string, patch: { name?: string; description?: string; config?: unknown }): ArchivalProfileView {
    const current = this.profile(profileId);
    const config = patch.config === undefined ? current.config : patch.config;
    if (!isProfileConfig(config)) throw new HttpError(400, 'profile config is invalid');
    this.sqlite.prepare(`UPDATE archival_profiles SET name = ?, description = ?, config_json = ?, updated_at = ? WHERE id = ?`).run(patch.name ?? current.name, patch.description ?? current.description, JSON.stringify(config), nowIso(), profileId);
    return this.profile(profileId);
  }

  deleteProfile(profileId: string): void {
    const current = this.profile(profileId);
    if (current.builtin) throw new HttpError(409, 'built-in profiles cannot be deleted');
    const used = asRow(this.sqlite.prepare(`SELECT repository_id FROM repository_profile_assignments WHERE profile_id = ? LIMIT 1`).get(profileId));
    if (used) throw new HttpError(409, 'profile is still assigned');
    this.sqlite.prepare(`DELETE FROM archival_profiles WHERE id = ?`).run(profileId);
  }

  profile(profileId: string): ArchivalProfileView {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM archival_profiles WHERE id = ?`).get(profileId));
    if (!row) throw new HttpError(404, 'profile not found');
    return mapProfile(row);
  }

  syncProfiles(): SyncProfileView[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM sync_profiles ORDER BY name ASC`).all()).map(mapSync);
  }

  createSyncProfile(input: { name: string; description?: string; schedule: unknown; timezone: string; paused?: boolean }): SyncProfileView {
    if (!isSchedule(input.schedule) || !isValidTimeZone(input.timezone)) throw new HttpError(400, 'schedule is invalid');
    const profileId = id();
    const now = nowIso();
    this.sqlite.prepare(`INSERT INTO sync_profiles (id, name, description, schedule_json, timezone, paused, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(profileId, input.name, input.description ?? '', JSON.stringify(input.schedule), input.timezone, input.paused ? 1 : 0, now, now);
    return this.syncProfile(profileId);
  }

  updateSyncProfile(profileId: string, patch: { name?: string; description?: string; schedule?: unknown; timezone?: string; paused?: boolean }): SyncProfileView {
    const current = this.syncProfile(profileId);
    const schedule = patch.schedule === undefined ? current.schedule : patch.schedule;
    const timezone = patch.timezone ?? current.timezone;
    if (!isSchedule(schedule) || !isValidTimeZone(timezone)) throw new HttpError(400, 'schedule is invalid');
    this.sqlite.prepare(`UPDATE sync_profiles SET name = ?, description = ?, schedule_json = ?, timezone = ?, paused = ?, updated_at = ? WHERE id = ?`).run(patch.name ?? current.name, patch.description ?? current.description, JSON.stringify(schedule), timezone, (patch.paused ?? current.paused) ? 1 : 0, nowIso(), profileId);
    return this.syncProfile(profileId);
  }

  deleteSyncProfile(profileId: string): void {
    const current = this.syncProfile(profileId);
    if (current.builtin) throw new HttpError(409, 'built-in schedules cannot be deleted');
    this.sqlite.prepare(`DELETE FROM sync_profiles WHERE id = ?`).run(profileId);
  }

  syncProfile(profileId: string): SyncProfileView {
    const row = asRow(this.sqlite.prepare(`SELECT * FROM sync_profiles WHERE id = ?`).get(profileId));
    if (!row) throw new HttpError(404, 'sync profile not found');
    return mapSync(row);
  }

  categories(): Category[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM categories ORDER BY name ASC`).all()).map((row) => ({ id: text(row, 'id'), name: text(row, 'name'), description: text(row, 'description'), createdAt: text(row, 'created_at') }));
  }

  createCategory(name: string, description = ''): Category {
    const categoryId = id();
    this.sqlite.prepare(`INSERT INTO categories (id, name, description, created_at) VALUES (?, ?, ?, ?)`).run(categoryId, name, description, nowIso());
    return { id: categoryId, name, description, createdAt: nowIso() };
  }

  updateCategory(categoryId: string, patch: { name?: string; description?: string }): Category {
    const current = this.categories().find((item) => item.id === categoryId);
    if (!current) throw new HttpError(404, 'category not found');
    this.sqlite.prepare(`UPDATE categories SET name = ?, description = ? WHERE id = ?`).run(patch.name ?? current.name, patch.description ?? current.description, categoryId);
    return { ...current, name: patch.name ?? current.name, description: patch.description ?? current.description };
  }

  deleteCategory(categoryId: string): void {
    this.sqlite.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
  }

  tags(): Tag[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM tags ORDER BY name ASC`).all()).map((row) => ({ id: text(row, 'id'), name: text(row, 'name'), createdAt: text(row, 'created_at') }));
  }

  createTag(name: string): Tag {
    const tagId = id();
    const createdAt = nowIso();
    this.sqlite.prepare(`INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)`).run(tagId, name, createdAt);
    return { id: tagId, name, createdAt };
  }

  deleteTag(tagId: string): void {
    this.sqlite.prepare(`DELETE FROM tags WHERE id = ?`).run(tagId);
  }

  collections(): Collection[] {
    return asRows(
      this.sqlite
        .prepare(`SELECT collections.*, (SELECT COUNT(*) FROM collection_members WHERE collection_id = collections.id) AS repository_count FROM collections ORDER BY name ASC`)
        .all(),
    ).map((row) => ({ id: text(row, 'id'), name: text(row, 'name'), description: text(row, 'description'), createdAt: text(row, 'created_at'), repositoryCount: integer(row, 'repository_count') }));
  }

  createCollection(name: string, description = ''): Collection {
    const collectionId = id();
    const createdAt = nowIso();
    this.sqlite.prepare(`INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)`).run(collectionId, name, description, createdAt);
    return { id: collectionId, name, description, createdAt, repositoryCount: 0 };
  }

  updateCollection(collectionId: string, patch: { name?: string; description?: string }): Collection {
    const current = this.collections().find((item) => item.id === collectionId);
    if (!current) throw new HttpError(404, 'collection not found');
    this.sqlite.prepare(`UPDATE collections SET name = ?, description = ? WHERE id = ?`).run(patch.name ?? current.name, patch.description ?? current.description, collectionId);
    return { ...current, name: patch.name ?? current.name, description: patch.description ?? current.description };
  }

  deleteCollection(collectionId: string): void {
    this.sqlite.prepare(`DELETE FROM collections WHERE id = ?`).run(collectionId);
  }

  setCollectionMembers(collectionId: string, repositoryIds: string[]): void {
    const replace = this.sqlite.transaction(() => {
      this.sqlite.prepare(`DELETE FROM collection_members WHERE collection_id = ?`).run(collectionId);
      for (const repositoryId of repositoryIds) {
        this.sqlite.prepare(`INSERT INTO collection_members (collection_id, repository_id, created_at) VALUES (?, ?, ?)`).run(collectionId, repositoryId, nowIso());
      }
    });
    replace();
  }

  credentials(): CredentialSummary[] {
    return asRows(this.sqlite.prepare(`SELECT id, provider, label, hint, created_at FROM credentials ORDER BY created_at DESC`).all()).map((row) => ({
      id: text(row, 'id'),
      provider: providerOf(text(row, 'provider')),
      label: text(row, 'label'),
      hint: text(row, 'hint'),
      createdAt: text(row, 'created_at'),
    }));
  }

  addCredential(provider: ProviderKind, label: string, token: string): CredentialSummary {
    const credentialId = id();
    const createdAt = nowIso();
    const hint = token.length <= 4 ? '****' : `••••${token.slice(-4)}`;
    this.sqlite.prepare(`INSERT INTO credentials (id, provider, label, token, hint, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(credentialId, provider, label, token, hint, createdAt);
    return { id: credentialId, provider, label, hint, createdAt };
  }

  deleteCredential(credentialId: string): void {
    this.sqlite.prepare(`DELETE FROM credentials WHERE id = ?`).run(credentialId);
  }

  dashboard(): Dashboard {
    const countsByStatus: Dashboard['countsByStatus'] = {};
    for (const row of asRows(this.sqlite.prepare(`SELECT archive_status, COUNT(*) AS count FROM repositories WHERE deleted_at IS NULL GROUP BY archive_status`).all())) {
      const status = text(row, 'archive_status');
      if (isArchiveStatus(status)) countsByStatus[status] = integer(row, 'count');
    }
    const attention = asRows(
      this.sqlite
        .prepare(
          `SELECT archive_components.component, archive_components.state, archive_components.error, repositories.id AS repository_id, repositories.display_name
           FROM archive_components JOIN repositories ON repositories.id = archive_components.repository_id
           WHERE archive_components.state IN ('failed', 'partial') AND repositories.deleted_at IS NULL
           ORDER BY repositories.updated_at DESC LIMIT 12`,
        )
        .all(),
    );
    const due = asRows(
      this.sqlite
        .prepare(
          `SELECT repositories.id AS repository_id, repositories.display_name, repository_sync_assignments.next_run_at
           FROM repository_sync_assignments
           JOIN repositories ON repositories.id = repository_sync_assignments.repository_id
           JOIN sync_profiles ON sync_profiles.id = repository_sync_assignments.sync_profile_id
           WHERE repository_sync_assignments.paused = 0 AND sync_profiles.paused = 0
             AND repository_sync_assignments.next_run_at IS NOT NULL AND repository_sync_assignments.next_run_at <= ?
             AND repositories.deleted_at IS NULL
           ORDER BY repository_sync_assignments.next_run_at ASC LIMIT 12`,
        )
        .all(nowIso()),
    );
    const recent = asRows(
      this.sqlite
        .prepare(
          `SELECT archive_events.*, repositories.display_name AS repository_name
           FROM archive_events LEFT JOIN repositories ON repositories.id = archive_events.repository_id
           ORDER BY archive_events.created_at DESC, archive_events.id DESC LIMIT 8`,
        )
        .all(),
    );
    return {
      countsByStatus,
      jobs: this.jobs.counts(),
      storage: {
        pools: this.storage.list().map((pool) => ({
          id: pool.id,
          name: pool.name,
          freeBytes: pool.freeBytes,
          totalBytes: pool.totalBytes,
          thresholdBytes: pool.freeSpaceThresholdBytes,
          repositoryCount: pool.repositoryCount,
        })),
      },
      recentEvents: recent.map(mapEvent),
      dueSyncs: due.map((row) => ({
        repositoryId: text(row, 'repository_id'),
        repositoryName: text(row, 'display_name'),
        nextRunAt: textOrNull(row, 'next_run_at'),
      })),
      attentionComponents: attention.map((row) => ({
        repositoryId: text(row, 'repository_id'),
        repositoryName: text(row, 'display_name'),
        component: text(row, 'component'),
        state: text(row, 'state'),
        error: textOrNull(row, 'error'),
      })),
    };
  }

  async rebuild(): Promise<{ scanned: number; restored: number; updated: number; conflicts: { path: string; reason: string }[]; invalid: { path: string; reason: string }[] }> {
    const report = { scanned: 0, restored: 0, updated: 0, conflicts: [] as { path: string; reason: string }[], invalid: [] as { path: string; reason: string }[] };
    for (const pool of this.storage.list()) {
      const archives = path.join(pool.rootPath, 'archives');
      const prefixes = await readdir(archives).catch(() => []);
      for (const prefix of prefixes) {
        if (!/^[0-9a-f]{2}$/i.test(prefix)) continue;
        const ids = await readdir(path.join(archives, prefix)).catch(() => []);
        for (const repositoryId of ids) {
          const manifestPath = path.join(archives, prefix, repositoryId, 'archive.json');
          report.scanned += 1;
          try {
            const manifest = await readManifest(manifestPath);
            const outcome = this.restoreManifest(pool.id, manifest);
            if (outcome === 'restored') report.restored += 1;
            if (outcome === 'updated') report.updated += 1;
            if (typeof outcome === 'object') report.conflicts.push({ path: manifestPath, reason: outcome.reason });
          } catch (error) {
            report.invalid.push({ path: manifestPath, reason: error instanceof Error ? error.message : 'invalid manifest' });
          }
        }
      }
    }
    return report;
  }

  async importLocal(sourcePath: string): Promise<{ repositoryId: string }> {
    const resolved = path.resolve(sourcePath);
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new HttpError(400, 'archive path is not a directory');
    const manifest = await readManifest(path.join(resolved, 'archive.json'));
    const pool = this.storage.chooseForNew();
    const destination = archivePaths(pool.rootPath, manifest.id).root;
    if (path.resolve(destination) !== resolved) {
      const { cp } = await import('node:fs/promises');
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(resolved, destination, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    }
    const { verifyArchiveTree } = await import('../verify-archive');
    const verification = await verifyArchiveTree(destination, path.join(destination, 'repository.git'));
    if (!verification.ok) throw new HttpError(409, 'import failed checksum or git verification');
    const outcome = this.restoreManifest(pool.id, manifest);
    if (typeof outcome === 'object') throw new HttpError(409, outcome.reason);
    return { repositoryId: manifest.id };
  }

  dueRepositories(now = nowIso()): string[] {
    return asRows(
      this.sqlite
        .prepare(
          `SELECT repository_sync_assignments.repository_id
           FROM repository_sync_assignments
           JOIN sync_profiles ON sync_profiles.id = repository_sync_assignments.sync_profile_id
           JOIN repositories ON repositories.id = repository_sync_assignments.repository_id
           WHERE repository_sync_assignments.paused = 0 AND sync_profiles.paused = 0
             AND repository_sync_assignments.next_run_at IS NOT NULL AND repository_sync_assignments.next_run_at <= ?
             AND repositories.deleted_at IS NULL
             AND repositories.id NOT IN (SELECT repository_id FROM jobs WHERE repository_id IS NOT NULL AND state IN ('queued', 'running', 'paused') AND type = 'sync')`,
        )
        .all(now),
    ).map((row) => text(row, 'repository_id'));
  }

  private restoreManifest(poolId: string, manifest: ArchiveManifest): 'restored' | 'updated' | { reason: string } {
    const byId = asRow(this.sqlite.prepare(`SELECT * FROM repositories WHERE id = ?`).get(manifest.id));
    const byIdentity = asRow(this.sqlite.prepare(`SELECT * FROM repositories WHERE identity_key = ? AND deleted_at IS NULL`).get(manifest.source.identityKey));
    if (byId && text(byId, 'identity_key') !== manifest.source.identityKey) return { reason: 'archive id belongs to a different source' };
    if (byIdentity && text(byIdentity, 'id') !== manifest.id) return { reason: 'source identity belongs to a different archive id' };
    const now = nowIso();
    if (!byId) {
      this.sqlite
        .prepare(
          `INSERT INTO repositories (
             id, identity_key, canonical_url, fetch_url, display_name, description, provider, provider_repo_id, default_branch,
             archive_status, upstream_status, health, size_bytes, storage_pool_id, relative_path, license, metadata_json, created_at, updated_at, last_success_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', 'unknown', 'unknown', 0, ?, ?, ?, '{}', ?, ?, ?)`,
        )
        .run(
          manifest.id,
          manifest.source.identityKey,
          manifest.source.canonicalUrl,
          manifest.source.canonicalUrl,
          manifest.displayName,
          manifest.description,
          manifest.source.provider,
          manifest.source.providerRepoId,
          manifest.source.defaultBranch,
          poolId,
          archiveRelativePath(manifest.id),
          manifest.license,
          manifest.createdAt,
          now,
          now,
        );
      this.insertSource(manifest.id, manifest.source.canonicalUrl, manifest.source.identityKey, 'canonical', now);
      const profileId = this.profileIdByName(manifest.profile.name) ?? 'profile-standard';
      this.sqlite.prepare(`INSERT INTO repository_profile_assignments (repository_id, profile_id, overrides_json, updated_at) VALUES (?, ?, '{}', ?)`).run(manifest.id, profileId, now);
      this.sqlite.prepare(`INSERT INTO repository_sync_assignments (repository_id, sync_profile_id, paused, updated_at) VALUES (?, 'sync-manual', 0, ?)`).run(manifest.id, now);
      for (const key of COMPONENT_KEYS) {
        const component = manifest.components[key];
        this.sqlite.prepare(`INSERT INTO archive_components (id, repository_id, component, state, size_bytes, last_success_at, error, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`).run(id(), manifest.id, key, component.state, component.sizeBytes, component.lastSuccessAt, component.error);
      }
      this.event(manifest.id, 'catalog.restored', `Restored ${manifest.displayName} from archive.json`, {});
      return 'restored';
    }
    this.sqlite.prepare(`UPDATE repositories SET display_name = ?, description = ?, storage_pool_id = ?, updated_at = ? WHERE id = ?`).run(manifest.displayName, manifest.description, poolId, now, manifest.id);
    for (const key of COMPONENT_KEYS) {
      const component = manifest.components[key];
      this.sqlite.prepare(`UPDATE archive_components SET state = ?, size_bytes = ?, last_success_at = ?, error = ? WHERE repository_id = ? AND component = ?`).run(component.state, component.sizeBytes, component.lastSuccessAt, component.error, manifest.id, key);
    }
    return 'updated';
  }

  private summary(repo: RepoRecord): RepositorySummary {
    const category = repo.categoryId ? this.categories().find((item) => item.id === repo.categoryId) ?? null : null;
    const tags = asRows(this.sqlite.prepare(`SELECT tags.id, tags.name FROM tags JOIN repository_tags ON repository_tags.tag_id = tags.id WHERE repository_tags.repository_id = ?`).all(repo.id)).map((row) => ({ id: text(row, 'id'), name: text(row, 'name') }));
    const pool = this.storage.list().find((item) => item.id === repo.storagePoolId);
    return {
      id: repo.id,
      canonicalUrl: repo.canonicalUrl,
      fetchUrl: repo.fetchUrl,
      displayName: repo.displayName,
      description: repo.description,
      provider: repo.provider,
      archiveStatus: isArchiveStatus(repo.archiveStatus) ? repo.archiveStatus : 'pending',
      upstreamStatus: upstreamOf(repo.upstreamStatus),
      health: healthOf(repo.health),
      defaultBranch: repo.defaultBranch,
      sizeBytes: repo.sizeBytes,
      category: category ? { id: category.id, name: category.name } : null,
      tags,
      components: this.components(repo.id),
      storagePool: pool ? { id: pool.id, name: pool.name } : null,
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
      deletedAt: repo.deletedAt,
      lastSyncAt: repo.lastSyncAt,
      lastSuccessAt: repo.lastSuccessAt,
    };
  }

  private detail(repo: RepoRecord): RepositoryDetail {
    const profile = this.effectiveProfile(repo.id);
    const sync = asRow(
      this.sqlite
        .prepare(
          `SELECT repository_sync_assignments.*, sync_profiles.name, sync_profiles.schedule_json
           FROM repository_sync_assignments JOIN sync_profiles ON sync_profiles.id = repository_sync_assignments.sync_profile_id
           WHERE repository_id = ?`,
        )
        .get(repo.id),
    );
    const schedule = sync ? parseJson(text(sync, 'schedule_json')) : { kind: 'manual' };
    return {
      ...this.summary(repo),
      license: repo.license,
      relativePath: repo.relativePath,
      metadata: repo.metadata,
      profile: { id: profile.id, name: profile.name, overrides: profile.overrides, effective: profile.config },
      sync: {
        profileId: sync ? text(sync, 'sync_profile_id') : 'sync-manual',
        profileName: sync ? text(sync, 'name') : 'Manual',
        paused: sync ? flag(sync, 'paused') : false,
        nextRunAt: sync ? textOrNull(sync, 'next_run_at') : null,
        lastRunAt: sync ? textOrNull(sync, 'last_run_at') : null,
        schedule: isSchedule(schedule) ? schedule : { kind: 'manual' },
      },
    };
  }

  private findByIdentity(identityKey: string, ...urls: string[]): RepoRecord | null {
    const row = asRow(this.sqlite.prepare(`SELECT repositories.* FROM repository_sources JOIN repositories ON repositories.id = repository_sources.repository_id WHERE repository_sources.identity_key = ? OR repository_sources.url = ? OR repository_sources.url = ? LIMIT 1`).get(identityKey, urls[0] ?? '', urls[1] ?? ''));
    return row ? mapRepo(row) : null;
  }

  private insertSource(repositoryId: string, url: string, identityKey: string, kind: string, now: string): void {
    this.sqlite.prepare(`INSERT OR IGNORE INTO repository_sources (id, repository_id, url, identity_key, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id(), repositoryId, url, identityKey, kind, now);
  }

  private requireProfile(profileId: string): void {
    this.profile(profileId);
  }

  private requireSyncProfile(profileId: string): SyncProfileView {
    return this.syncProfile(profileId);
  }

  private profileConfig(profileId: string): ArchivalProfileConfig {
    return this.profile(profileId).config;
  }

  private profileIdByName(name: string): string | null {
    const row = asRow(this.sqlite.prepare(`SELECT id FROM archival_profiles WHERE name = ?`).get(name));
    return row ? text(row, 'id') : null;
  }

  private async permit(fetchUrl: string): Promise<void> {
    const policy: NetworkPolicy = this.settings.networkPolicy();
    try {
      await assertRemotePermitted(fetchUrl, policy);
    } catch (error) {
      if (error instanceof UrlRejectedError) throw new HttpError(400, error.message);
      throw error;
    }
  }
}

export interface ListQuery {
  limit?: number;
  cursor?: string | null;
  q?: string | null;
  status?: string | null;
  provider?: string | null;
  categoryId?: string | null;
  tagId?: string | null;
  collectionId?: string | null;
  sort?: 'updated' | 'name' | 'size';
  includeDeleted?: boolean;
}

function mapRepo(row: Record<string, unknown>): RepoRecord {
  return {
    id: text(row, 'id'),
    identityKey: text(row, 'identity_key'),
    canonicalUrl: text(row, 'canonical_url'),
    fetchUrl: text(row, 'fetch_url'),
    displayName: text(row, 'display_name'),
    description: text(row, 'description'),
    provider: providerOf(text(row, 'provider')),
    providerRepoId: textOrNull(row, 'provider_repo_id'),
    defaultBranch: textOrNull(row, 'default_branch'),
    categoryId: textOrNull(row, 'category_id'),
    archiveStatus: text(row, 'archive_status'),
    upstreamStatus: text(row, 'upstream_status'),
    health: text(row, 'health'),
    sizeBytes: integer(row, 'size_bytes'),
    storagePoolId: text(row, 'storage_pool_id'),
    relativePath: text(row, 'relative_path'),
    metadata: jsonRecord(text(row, 'metadata_json')),
    license: textOrNull(row, 'license'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    deletedAt: textOrNull(row, 'deleted_at'),
    lastSyncAt: textOrNull(row, 'last_sync_at'),
    lastSuccessAt: textOrNull(row, 'last_success_at'),
  };
}

function mapComponent(row: Record<string, unknown>): ComponentSnapshot {
  const component = text(row, 'component');
  if (!isComponentKey(component)) throw new Error(`unknown component ${component}`);
  return {
    component,
    state: stateOf(text(row, 'state')),
    sizeBytes: integer(row, 'size_bytes'),
    lastSuccessAt: textOrNull(row, 'last_success_at'),
    error: textOrNull(row, 'error'),
  };
}

function isLfsObject(value: unknown): value is { path: string; oid: string; size: number } {
  return isRecord(value) && typeof value.path === 'string' && typeof value.oid === 'string' && typeof value.size === 'number';
}

function mapProfile(row: Record<string, unknown>): ArchivalProfileView {
  const config = parseJson(text(row, 'config_json'));
  if (!isProfileConfig(config)) throw new Error('stored profile is invalid');
  return { id: text(row, 'id'), name: text(row, 'name'), description: text(row, 'description'), builtin: flag(row, 'is_builtin'), config, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}

function mapSync(row: Record<string, unknown>): SyncProfileView {
  const schedule = parseJson(text(row, 'schedule_json'));
  if (!isSchedule(schedule)) throw new Error('stored schedule is invalid');
  return { id: text(row, 'id'), name: text(row, 'name'), description: text(row, 'description'), builtin: flag(row, 'is_builtin'), schedule, timezone: text(row, 'timezone'), paused: flag(row, 'paused'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}

function mapTextRecord(row: Record<string, unknown>): TextRecord {
  const body = text(row, 'body');
  const extra = jsonRecord(text(row, 'extra_json'));
  return {
    id: text(row, 'id'),
    providerKey: text(row, 'provider_key'),
    parentKey: textOrNull(row, 'parent_key'),
    number: integerOrNull(row, 'number'),
    title: text(row, 'title'),
    state: text(row, 'state'),
    author: text(row, 'author'),
    createdAt: textOrNull(row, 'created_at'),
    updatedAt: textOrNull(row, 'updated_at'),
    body: body.slice(0, 20_000),
    url: textOrNull(row, 'url'),
    bodyTruncated: body.length > 20_000,
    upstreamMissing: extra.upstreamMissing === true,
  };
}

function mapEvent(row: Record<string, unknown>): ArchiveEvent {
  return {
    id: text(row, 'id'),
    repositoryId: textOrNull(row, 'repository_id'),
    repositoryName: textOrNull(row, 'repository_name'),
    kind: text(row, 'kind'),
    message: text(row, 'message'),
    createdAt: text(row, 'created_at'),
    detail: jsonRecord(text(row, 'detail_json')),
  };
}

function pageEvents(rows: Record<string, unknown>[], limit: number): Page<ArchiveEvent> {
  const items = rows.slice(0, limit).map(mapEvent);
  const extra = rows[limit];
  return { items, nextCursor: extra ? encodeCursor({ k: text(extra, 'created_at'), id: text(extra, 'id') }) : null };
}

function rollup(components: ComponentSnapshot[], health: string): ArchiveStatus {
  if (health === 'corrupt') return 'corrupt';
  const relevant = components.filter((component) => component.state !== 'skipped' && component.state !== 'unsupported');
  if (relevant.some((component) => component.state === 'running')) return 'running';
  if (relevant.some((component) => component.state === 'failed' || component.state === 'partial')) return 'partial';
  if (relevant.some((component) => component.state === 'pending' || component.state === 'paused')) return 'queued';
  if (relevant.length > 0 && relevant.every((component) => component.state === 'complete')) return 'healthy';
  return 'pending';
}

function readOverrides(value: unknown): ProfileOverrides {
  if (!isRecord(value)) return {};
  const overrides: ProfileOverrides = {};
  if (isRecord(value.components)) {
    overrides.components = {};
    for (const key of COMPONENT_KEYS) {
      if (typeof value.components[key] === 'boolean') overrides.components[key] = value.components[key];
    }
  }
  if (isRecord(value.limits)) {
    overrides.limits = {
      maxRepositoryBytes: limitOf(value.limits.maxRepositoryBytes),
      maxAssetBytes: limitOf(value.limits.maxAssetBytes),
      maxComponentBytes: limitOf(value.limits.maxComponentBytes),
    };
  }
  if (Array.isArray(value.exclusions) && value.exclusions.every((entry) => typeof entry === 'string')) overrides.exclusions = value.exclusions;
  return overrides;
}

function limitOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && value >= 0 ? value : null;
}

function mergeArchived(previous: ManifestArchivedRef[], added: ManifestArchivedRef[]): ManifestArchivedRef[] {
  const names = new Set(previous.map((ref) => ref.name));
  return [...previous, ...added.filter((ref) => !names.has(ref.name))];
}

function providerOf(value: string): ProviderKind {
  if (value === 'github' || value === 'gitlab' || value === 'git') return value;
  return 'git';
}

function stateOf(value: string): ComponentState {
  if (value === 'pending' || value === 'running' || value === 'complete' || value === 'partial' || value === 'failed' || value === 'unsupported' || value === 'skipped' || value === 'paused') return value;
  return 'pending';
}

function isArchiveStatus(value: string): value is ArchiveStatus {
  return value === 'pending' || value === 'queued' || value === 'running' || value === 'healthy' || value === 'partial' || value === 'unavailable' || value === 'corrupt' || value === 'deleted';
}

function upstreamOf(value: string): RepositorySummary['upstreamStatus'] {
  if (value === 'unknown' || value === 'reachable' || value === 'unavailable' || value === 'not_found' || value === 'auth_required') return value;
  return 'unknown';
}

function healthOf(value: string): RepositorySummary['health'] {
  if (value === 'unknown' || value === 'ok' || value === 'warning' || value === 'corrupt') return value;
  return 'unknown';
}

function escapeLike(value: string): string {
  return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

function decodeListCursor(value: string, sort: string): { k: string; id: string } {
  const parsed = decodeCursor(value);
  if (!isRecord(parsed) || parsed.s !== sort || typeof parsed.k !== 'string' || typeof parsed.id !== 'string') {
    throw new HttpError(400, 'cursor is invalid');
  }
  return { k: parsed.k, id: parsed.id };
}

function decodePair(value: string): { k: string; id: string } {
  const parsed = decodeCursor(value);
  if (!isRecord(parsed) || typeof parsed.k !== 'string' || typeof parsed.id !== 'string') throw new HttpError(400, 'cursor is invalid');
  return { k: parsed.k, id: parsed.id };
}

function textUrls(input: string): { line: number; url: string; name?: string; categoryId?: string; tagIds?: string[] }[] {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, url: line.trim() }))
    .filter((line) => line.url.length > 0 && !line.url.startsWith('#'));
}

function csvUrls(input: string): { line: number; url: string; name?: string; categoryId?: string; tagIds?: string[] }[] {
  const rows = parseCsv(input).filter((row) => row.some((cell) => cell.trim().length > 0));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const hasHeader = header.includes('url');
  const body = hasHeader ? rows.slice(1) : rows;
  const urlIndex = hasHeader ? header.indexOf('url') : 0;
  const nameIndex = header.indexOf('name');
  return body.map((row, index) => ({
    line: index + (hasHeader ? 2 : 1),
    url: (row[urlIndex] ?? '').trim(),
    name: nameIndex >= 0 ? row[nameIndex]?.trim() : undefined,
  })).filter((row) => row.url.length > 0);
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char ?? '';
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char ?? '';
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function walkSize(root: string): Promise<number> {
  let total = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await walkSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

export type { ExportFormat };
