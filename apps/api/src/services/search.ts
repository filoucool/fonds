import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  DEFAULT_SEARCH_INDEX,
  matchesAnyExclusion,
  type GlobalSearchHit,
  type IndexJobState,
  type SearchCapability,
  type SearchIndexConfig,
  type SearchIndexStatus,
} from '@fonds/shared';
import { asRow, nowIso, text } from '../rows';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';
import type { SettingsService } from './settings';
import { listTreeRecursive, readBlob } from './browse';

const INDEX_SCHEMA_VERSION = 1;

export interface SearchFilters {
  provider: string | null;
  categoryId: string | null;
  tagId: string | null;
  collectionId: string | null;
  status: string | null;
}

export class SearchService {
  private indexDb: Database.Database | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly indexPath: string,
  ) {}

  private db(): Database.Database {
    if (this.indexDb) return this.indexDb;
    mkdirSync(path.dirname(this.indexPath), { recursive: true, mode: 0o700 });
    const db = new Database(this.indexPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    this.ensureSchema(db);
    this.indexDb = db;
    return db;
  }

  private ensureSchema(db: Database.Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const version = db.prepare(`SELECT value FROM index_meta WHERE key = 'schema_version'`).get() as { value: string } | undefined;
    if (!version) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS file_paths USING fts5(
          repository_id UNINDEXED,
          path,
          tokenize = 'unicode61'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS source_text USING fts5(
          repository_id UNINDEXED,
          path UNINDEXED,
          content,
          tokenize = 'unicode61'
        );
      `);
      db.prepare(`INSERT INTO index_meta (key, value) VALUES ('schema_version', ?)`).run(String(INDEX_SCHEMA_VERSION));
    }
  }

  status(repositoryId: string): SearchIndexStatus {
    this.catalog.require(repositoryId);
    const row = asRow(
      this.sqlite
        .prepare(`SELECT state, config_json, file_count, source_text_bytes, last_indexed_at, last_error FROM repository_search_index WHERE repository_id = ?`)
        .get(repositoryId),
    );
    const enabled = row ? parseConfig(row.config_json) : { ...DEFAULT_SEARCH_INDEX };
    return {
      repositoryId,
      state: row ? asIndexState(text(row, 'state')) : 'disabled',
      enabled,
      fileCount: row ? Number(row.file_count) : 0,
      sourceTextBytes: row ? Number(row.source_text_bytes) : 0,
      lastIndexedAt: row?.last_indexed_at === null || row?.last_indexed_at === undefined ? null : text(row, 'last_indexed_at'),
      lastError: row?.last_error === null || row?.last_error === undefined ? null : text(row, 'last_error'),
    };
  }

  upsertConfig(repositoryId: string, patch: Partial<SearchIndexConfig>): SearchIndexStatus {
    this.catalog.require(repositoryId);
    const current = this.status(repositoryId);
    const next = { ...current.enabled, ...patch };
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO repository_search_index (repository_id, state, config_json, file_count, source_text_bytes, last_indexed_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repository_id) DO UPDATE SET
           config_json = excluded.config_json,
           state = CASE WHEN excluded.config_json LIKE '%"sourceText":true%' OR excluded.config_json LIKE '%"filenames":true%' THEN 'idle' ELSE 'disabled' END,
           updated_at = excluded.updated_at`,
      )
      .run(repositoryId, enabledState(next), JSON.stringify(next), current.fileCount, current.sourceTextBytes, current.lastIndexedAt, current.lastError, now);
    return this.status(repositoryId);
  }

  scheduleAfterSync(repositoryId: string): void {
    const status = this.status(repositoryId);
    if (status.state === 'paused' || status.state === 'disabled') return;
    if (!status.enabled.filenames && !status.enabled.sourceText) return;
    if (status.state === 'running' || status.state === 'queued') return;
    this.catalog.enqueueTyped(repositoryId, 'index', { reason: 'after_sync' });
  }

  pauseIndex(repositoryId: string): SearchIndexStatus {
    this.catalog.require(repositoryId);
    this.sqlite
      .prepare(`UPDATE repository_search_index SET state = 'paused', updated_at = ? WHERE repository_id = ?`)
      .run(nowIso(), repositoryId);
    return this.status(repositoryId);
  }

  resumeIndex(repositoryId: string): { status: SearchIndexStatus; jobId: string } {
    this.catalog.require(repositoryId);
    this.sqlite
      .prepare(`UPDATE repository_search_index SET state = 'idle', updated_at = ? WHERE repository_id = ?`)
      .run(nowIso(), repositoryId);
    const jobId = this.catalog.enqueueTyped(repositoryId, 'index', { reason: 'resume' });
    return { status: this.status(repositoryId), jobId };
  }

  deleteIndex(repositoryId: string): void {
    this.catalog.require(repositoryId);
    const db = this.db();
    db.prepare(`DELETE FROM file_paths WHERE repository_id = ?`).run(repositoryId);
    db.prepare(`DELETE FROM source_text WHERE repository_id = ?`).run(repositoryId);
    this.sqlite
      .prepare(`UPDATE repository_search_index SET state = 'disabled', file_count = 0, source_text_bytes = 0, last_indexed_at = NULL, last_error = NULL, updated_at = ? WHERE repository_id = ?`)
      .run(nowIso(), repositoryId);
  }

  async rebuild(repositoryId: string, signal: AbortSignal): Promise<void> {
    const repo = this.catalog.require(repositoryId);
    const config = this.status(repositoryId).enabled;
    if (!config.filenames && !config.sourceText) return;
    this.sqlite.prepare(`UPDATE repository_search_index SET state = 'running', last_error = NULL, updated_at = ? WHERE repository_id = ?`).run(nowIso(), repositoryId);
    const db = this.db();
    const wipe = db.transaction(() => {
      db.prepare(`DELETE FROM file_paths WHERE repository_id = ?`).run(repositoryId);
      db.prepare(`DELETE FROM source_text WHERE repository_id = ?`).run(repositoryId);
    });
    wipe();
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const ref = repo.defaultBranch ? `refs/heads/${repo.defaultBranch}` : 'HEAD';
    let fileCount = 0;
    let sourceBytes = 0;
    try {
      const paths = await listTreeRecursive(located.paths.gitDir, ref);
      const insertPath = db.prepare(`INSERT INTO file_paths (repository_id, path) VALUES (?, ?)`);
      const insertSource = db.prepare(`INSERT INTO source_text (repository_id, path, content) VALUES (?, ?, ?)`);
      for (const entry of paths) {
        if (signal.aborted) throw new Error('index cancelled');
        if (entry.kind !== 'blob') continue;
        const size = entry.sizeBytes ?? 0;
        if (config.filenames) {
          insertPath.run(repositoryId, entry.path);
          fileCount += 1;
        }
        if (config.sourceText && size <= config.maxFileBytes && !matchesAnyExclusion(config.excludeGlobs, entry.path)) {
          const content = await readBlobText(located.paths.gitDir, ref, entry.path, size, config.maxFileBytes);
          if (content) {
            insertSource.run(repositoryId, entry.path, content);
            sourceBytes += content.length;
          }
        }
      }
      this.sqlite
        .prepare(
          `UPDATE repository_search_index SET state = 'idle', file_count = ?, source_text_bytes = ?, last_indexed_at = ?, updated_at = ? WHERE repository_id = ?`,
        )
        .run(fileCount, sourceBytes, nowIso(), nowIso(), repositoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'index failed';
      this.sqlite.prepare(`UPDATE repository_search_index SET state = 'error', last_error = ?, updated_at = ? WHERE repository_id = ?`).run(message.slice(0, 2000), nowIso(), repositoryId);
      throw error;
    }
  }

  search(query: string, capabilities: SearchCapability[], limit: number, filters: SearchFilters | null = null): GlobalSearchHit[] {
    const q = query.trim();
    const hasFilter =
      Boolean(filters) &&
      Boolean(filters?.provider || filters?.categoryId || filters?.tagId || filters?.collectionId || filters?.status);
    if (q.length === 0 && !hasFilter) return [];
    const allowed = this.allowedRepositoryIds(filters);
    const hits: GlobalSearchHit[] = [];
    if (capabilities.includes('metadata') || capabilities.length === 0 || q.length === 0) {
      const page = this.catalog.list({
        limit: Math.min(limit, 50),
        cursor: null,
        q: q.length > 0 ? q : null,
        status: filters?.status ?? null,
        provider: filters?.provider ?? null,
        categoryId: filters?.categoryId ?? null,
        tagId: filters?.tagId ?? null,
        collectionId: filters?.collectionId ?? null,
        sort: 'updated',
        includeDeleted: false,
      });
      for (const item of page.items) {
        if (allowed && !allowed.has(item.id)) continue;
        hits.push({
          repositoryId: item.id,
          displayName: item.displayName,
          kind: 'metadata',
          path: null,
          snippet: item.canonicalUrl,
          score: 1,
        });
      }
    }
    if (q.length > 0 && (capabilities.includes('filenames') || capabilities.includes('source_text'))) {
      const db = this.db();
      if (capabilities.includes('filenames')) {
        const rows = db
          .prepare(
            `SELECT repository_id, path, bm25(file_paths) AS score FROM file_paths WHERE path MATCH ? ORDER BY score LIMIT ?`,
          )
          .all(ftsQuery(q), limit) as { repository_id: string; path: string; score: number }[];
        for (const row of rows) {
          if (allowed && !allowed.has(row.repository_id)) continue;
          hits.push({
            repositoryId: row.repository_id,
            displayName: this.catalog.require(row.repository_id).displayName,
            kind: 'filename',
            path: row.path,
            snippet: null,
            score: row.score,
          });
        }
      }
      if (capabilities.includes('source_text')) {
        const rows = db
          .prepare(
            `SELECT repository_id, path, snippet(source_text, 2, '[', ']', '…', 12) AS snippet, bm25(source_text) AS score
             FROM source_text WHERE content MATCH ? ORDER BY score LIMIT ?`,
          )
          .all(ftsQuery(q), limit) as { repository_id: string; path: string; snippet: string; score: number }[];
        for (const row of rows) {
          if (allowed && !allowed.has(row.repository_id)) continue;
          hits.push({
            repositoryId: row.repository_id,
            displayName: this.catalog.require(row.repository_id).displayName,
            kind: 'source',
            path: row.path,
            snippet: row.snippet,
            score: row.score,
          });
        }
      }
    }
    return hits.slice(0, limit);
  }

  private allowedRepositoryIds(filters: SearchFilters | null): Set<string> | null {
    if (!filters) return null;
    const hasFilter = filters.provider || filters.categoryId || filters.tagId || filters.collectionId || filters.status;
    if (!hasFilter) return null;
    const page = this.catalog.list({
      limit: 500,
      cursor: null,
      q: null,
      status: filters.status,
      provider: filters.provider,
      categoryId: filters.categoryId,
      tagId: filters.tagId,
      collectionId: filters.collectionId,
      sort: 'updated',
      includeDeleted: false,
    });
    return new Set(page.items.map((item) => item.id));
  }

  usageBytes(): number {
    if (!existsSync(this.indexPath)) return 0;
    try {
      return statSync(this.indexPath).size;
    } catch {
      return 0;
    }
  }
}

function parseConfig(raw: unknown): SearchIndexConfig {
  if (typeof raw !== 'string') return { ...DEFAULT_SEARCH_INDEX };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_SEARCH_INDEX };
    const record = parsed as Record<string, unknown>;
    return {
      metadata: record.metadata !== false,
      filenames: record.filenames === true,
      sourceText: record.sourceText === true,
      maxFileBytes: typeof record.maxFileBytes === 'number' ? record.maxFileBytes : DEFAULT_SEARCH_INDEX.maxFileBytes,
      excludeGlobs: Array.isArray(record.excludeGlobs) ? record.excludeGlobs.filter((entry): entry is string => typeof entry === 'string') : DEFAULT_SEARCH_INDEX.excludeGlobs,
    };
  } catch {
    return { ...DEFAULT_SEARCH_INDEX };
  }
}

function enabledState(config: SearchIndexConfig): IndexJobState {
  if (config.filenames || config.sourceText) return 'idle';
  return 'disabled';
}

function asIndexState(value: string): IndexJobState {
  if (value === 'disabled' || value === 'idle' || value === 'queued' || value === 'running' || value === 'paused' || value === 'error') return value;
  return 'disabled';
}

function ftsQuery(q: string): string {
  const tokens = q.split(/\s+/).filter((part) => part.length > 0);
  return tokens.map((part) => `"${part.replace(/"/g, '')}"`).join(' AND ');
}

async function readBlobText(gitDir: string, ref: string, filePath: string, size: number, maxBytes: number): Promise<string | null> {
  if (size > maxBytes) return null;
  try {
    const blob = await readBlob(gitDir, ref, filePath);
    if (blob.binary || blob.truncated || !blob.content) return null;
    return blob.content.slice(0, maxBytes);
  } catch {
    return null;
  }
}
