import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { parseBackupManifest } from '@repo-archive/archive-format';
import { type RecoveryKind, type RecoveryRunSummary } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { asRow, asRows, id, nowIso, text, textOrNull } from '../rows';
import type { BackupService } from './backups';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';

export class RecoveryService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dataDir: string,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
    private readonly backups: BackupService,
  ) {}

  list(): RecoveryRunSummary[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM recovery_runs ORDER BY created_at DESC LIMIT 100`).all()).map((row) => mapRun(row));
  }

  start(input: {
    kind: RecoveryKind;
    sourceBackupId?: string | null;
    sandbox?: boolean;
    operatorNote?: string | null;
    repositoryId?: string | null;
    relativeAssetPath?: string | null;
    poolId?: string | null;
  }): RecoveryRunSummary {
    const runId = id();
    const now = nowIso();
    const scope = {
      repositoryId: input.repositoryId ?? null,
      relativeAssetPath: input.relativeAssetPath ?? null,
      poolId: input.poolId ?? null,
    };
    this.sqlite
      .prepare(
        `INSERT INTO recovery_runs (id, kind, scope_json, source_backup_id, sandbox, operator_note, status, before_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', '{}', ?)`,
      )
      .run(
        runId,
        input.kind,
        JSON.stringify(scope),
        input.sourceBackupId ?? null,
        input.sandbox ? 1 : 0,
        input.operatorNote ?? null,
        now,
      );
    try {
      const after = this.execute(input.kind, scope, input.sourceBackupId ?? null, input.sandbox === true);
      this.sqlite
        .prepare(`UPDATE recovery_runs SET status = 'completed', after_json = ?, finished_at = ? WHERE id = ?`)
        .run(JSON.stringify(after), nowIso(), runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'recovery failed';
      this.sqlite.prepare(`UPDATE recovery_runs SET status = 'failed', after_json = ?, finished_at = ? WHERE id = ?`).run(JSON.stringify({ error: message }), nowIso(), runId);
      throw error;
    }
    return mapRun(asRow(this.sqlite.prepare(`SELECT * FROM recovery_runs WHERE id = ?`).get(runId)) ?? {});
  }

  private execute(
    kind: RecoveryKind,
    scope: { repositoryId: string | null; relativeAssetPath: string | null; poolId: string | null },
    sourceBackupId: string | null,
    sandbox: boolean,
  ): Record<string, unknown> {
    if (!sourceBackupId) throw new HttpError(400, 'sourceBackupId is required');
    const run = this.backups.get(sourceBackupId);
    if (!run.manifestPath) throw new HttpError(404, 'backup manifest is not recorded');
    const backupRoot = path.dirname(run.manifestPath);
    const catalogPath = path.join(backupRoot, 'catalog.sqlite');
    if (!existsSync(catalogPath)) throw new HttpError(404, 'backup catalog is not present locally; run backup to this host first');
    parseBackupManifest(readFileSync(path.join(backupRoot, 'backup-manifest.json'), 'utf8'));

    if (kind === 'single-asset') {
      return this.restoreSingleAsset(scope, backupRoot, sandbox);
    }
    if (kind === 'single-archive') {
      return this.restoreSingleArchive(scope, backupRoot, sandbox);
    }
    if (kind === 'catalog') {
      return this.restoreCatalog(catalogPath, sandbox);
    }
    if (kind === 'storage-pool') {
      return this.restorePool(scope, backupRoot, sandbox);
    }
    return this.restoreFull(catalogPath, backupRoot, sandbox);
  }

  private restoreSingleAsset(
    scope: { repositoryId: string | null; relativeAssetPath: string | null },
    backupRoot: string,
    sandbox: boolean,
  ): Record<string, unknown> {
    if (!scope.repositoryId || !scope.relativeAssetPath) throw new HttpError(400, 'repositoryId and relativeAssetPath are required');
    const repo = this.catalog.require(scope.repositoryId);
    const pool = this.storage.get(repo.storagePoolId);
    const source = path.join(backupRoot, 'pools', pool.name, repo.relativePath, scope.relativeAssetPath);
    const targetRoot = sandbox ? path.join(this.dataDir, 'app', 'recovery-sandbox', scope.repositoryId) : path.join(pool.rootPath, repo.relativePath);
    const target = path.join(targetRoot, scope.relativeAssetPath);
    if (!existsSync(source)) throw new HttpError(404, 'asset is not present in backup');
    const evidence = sandbox ? null : `${target}.damaged-${Date.now()}`;
    if (!sandbox && existsSync(target)) {
      copyFileSync(target, evidence ?? `${target}.evidence`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    return { restored: target, evidence, sandbox };
  }

  private restoreSingleArchive(
    scope: { repositoryId: string | null },
    backupRoot: string,
    sandbox: boolean,
  ): Record<string, unknown> {
    if (!scope.repositoryId) throw new HttpError(400, 'repositoryId is required');
    const repo = this.catalog.require(scope.repositoryId);
    const pool = this.storage.get(repo.storagePoolId);
    const source = path.join(backupRoot, 'pools', pool.name, repo.relativePath);
    const target = sandbox ? path.join(this.dataDir, 'app', 'recovery-sandbox', scope.repositoryId) : path.join(pool.rootPath, repo.relativePath);
    if (!existsSync(source)) throw new HttpError(404, 'archive is not in backup');
    if (sandbox) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true });
      return { restored: target, sandbox: true };
    }
    const evidence = `${target}.pre-recovery-${Date.now()}`;
    if (existsSync(target)) cpSync(target, evidence, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    return { restored: target, evidence, sandbox: false };
  }

  private restoreCatalog(catalogPath: string, sandbox: boolean): Record<string, unknown> {
    const live = path.join(this.dataDir, 'app', 'catalog.sqlite');
    const evidence = `${live}.pre-recovery-${Date.now()}`;
    if (!sandbox && existsSync(live)) copyFileSync(live, evidence);
    const destination = sandbox ? path.join(this.dataDir, 'app', 'recovery-sandbox', 'catalog.sqlite') : live;
    copyFileSync(catalogPath, destination);
    chmodSync(destination, 0o600);
  return { restored: destination, evidence: sandbox ? null : evidence, sandbox };
  }

  private restorePool(
    scope: { poolId: string | null },
    backupRoot: string,
    sandbox: boolean,
  ): Record<string, unknown> {
    if (!scope.poolId) throw new HttpError(400, 'poolId is required');
    const pool = this.storage.get(scope.poolId);
    const source = path.join(backupRoot, 'pools', pool.name);
    const destination = sandbox ? path.join(this.dataDir, 'app', 'recovery-sandbox', pool.name) : pool.rootPath;
    if (!existsSync(source)) throw new HttpError(404, 'pool backup is missing');
    if (sandbox) {
      rmSync(destination, { recursive: true, force: true });
      cpSync(source, destination, { recursive: true });
      return { restored: destination, sandbox: true };
    }
    const evidence = `${destination}.pre-recovery-${Date.now()}`;
    if (existsSync(destination)) cpSync(destination, evidence, { recursive: true });
    cpSync(source, destination, { recursive: true });
    return { restored: destination, evidence, sandbox: false };
  }

  private restoreFull(catalogPath: string, backupRoot: string, sandbox: boolean): Record<string, unknown> {
    const catalog = this.restoreCatalog(catalogPath, sandbox);
    const poolsDir = path.join(backupRoot, 'pools');
    if (!existsSync(poolsDir)) return { ...catalog, poolsRestored: 0 };
    let poolsRestored = 0;
    for (const poolName of readdirSync(poolsDir)) {
      const source = path.join(poolsDir, poolName);
      const pool = this.storage.list().find((item) => item.name === poolName);
      if (!pool) continue;
      const destination = sandbox ? path.join(this.dataDir, 'app', 'recovery-sandbox', poolName) : pool.rootPath;
      cpSync(source, destination, { recursive: true });
      poolsRestored += 1;
    }
    return { ...catalog, poolsRestored };
  }
}

function mapRun(row: Record<string, unknown>): RecoveryRunSummary {
  return {
    id: text(row, 'id'),
    kind: text(row, 'kind') as RecoveryKind,
    sandbox: Number(row.sandbox) === 1,
    status: text(row, 'status'),
    sourceBackupId: textOrNull(row, 'source_backup_id'),
    operatorNote: textOrNull(row, 'operator_note'),
    createdAt: text(row, 'created_at'),
    finishedAt: textOrNull(row, 'finished_at'),
  };
}
