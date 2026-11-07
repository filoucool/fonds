import type Database from 'better-sqlite3';
import { isRecord, type IntegrityRun } from '@repo-archive/shared';
import { asRows, id, jsonRecord, nowIso, text, textOrNull } from '../rows';
import type { CatalogService } from './catalog';
import type { StorageService } from './storage';
import { verifyArchiveTree } from '../verify-archive';

export class IntegrityService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly catalog: CatalogService,
    private readonly storage: StorageService,
  ) {}

  async verify(repositoryId: string): Promise<IntegrityRun> {
    const repo = this.catalog.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const startedAt = nowIso();
    const verification = await verifyArchiveTree(located.paths.root, located.paths.gitDir);
    const finishedAt = nowIso();
    const runId = id();
    this.sqlite
      .prepare(
        `INSERT INTO integrity_runs (id, repository_id, scope, verification_type, status, results_json, started_at, finished_at)
         VALUES (?, ?, 'repository', 'git+sha256', ?, ?, ?, ?)`,
      )
      .run(runId, repositoryId, verification.ok ? 'passed' : 'failed', JSON.stringify({ ok: verification.ok, checks: verification.checks }), startedAt, finishedAt);
    this.sqlite
      .prepare(`UPDATE repositories SET health = ?, archive_status = CASE WHEN ? = 0 THEN 'corrupt' ELSE archive_status END, updated_at = ? WHERE id = ?`)
      .run(verification.ok ? 'ok' : 'corrupt', verification.ok ? 1 : 0, finishedAt, repositoryId);
    if (verification.ok) this.catalog.recompute(repositoryId);
    this.catalog.event(repositoryId, verification.ok ? 'integrity.passed' : 'integrity.failed', verification.ok ? 'Verification passed' : 'Verification found corruption', {
      checks: verification.checks.filter((check) => !check.ok).length,
    });
    return {
      id: runId,
      scope: 'repository',
      verificationType: 'git+sha256',
      status: verification.ok ? 'passed' : 'failed',
      startedAt,
      finishedAt,
      results: { ok: verification.ok, checks: verification.checks },
    };
  }

  list(repositoryId: string): IntegrityRun[] {
    return asRows(this.sqlite.prepare(`SELECT * FROM integrity_runs WHERE repository_id = ? ORDER BY started_at DESC LIMIT 20`).all(repositoryId)).map((row) => {
      const results = jsonRecord(text(row, 'results_json'));
      const checks = Array.isArray(results.checks) ? results.checks.filter(isCheck) : [];
      return {
        id: text(row, 'id'),
        scope: text(row, 'scope'),
        verificationType: text(row, 'verification_type'),
        status: text(row, 'status'),
        startedAt: text(row, 'started_at'),
        finishedAt: textOrNull(row, 'finished_at'),
        results: { ok: results.ok === true, checks },
      };
    });
  }
}

function isCheck(value: unknown): value is IntegrityRun['results']['checks'][number] {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.ok === 'boolean' && typeof value.detail === 'string' && typeof value.component === 'string';
}
