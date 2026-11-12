import type Database from 'better-sqlite3';
import { isRecord, type JobState, type JobType } from '@fonds/shared';
import { HttpError } from '../errors';
import { asRow, asRows, id, integer, integerOrNull, jsonRecord, nowIso, text, textOrNull } from '../rows';

export interface StepRecord {
  id: string;
  component: string;
  state: string;
  sequence: number;
  checkpoint: Record<string, unknown>;
  bytesDone: number;
  bytesTotal: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface JobRecord {
  id: string;
  repositoryId: string | null;
  repositoryName: string | null;
  type: JobType;
  state: JobState;
  priority: number;
  attempt: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  errorCategory: string | null;
  errorMessage: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  notBefore: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: StepRecord[];
}

const LEASE_MS = 60_000;

export class JobsService {
  constructor(private readonly sqlite: Database.Database) {}

  enqueue(input: {
    repositoryId?: string | null;
    type: JobType;
    payload?: Record<string, unknown>;
    priority?: number;
    maxAttempts?: number;
    notBefore?: string | null;
  }): string {
    const jobId = id();
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO jobs (id, repository_id, type, state, priority, attempt, max_attempts, payload_json, checkpoint_json, not_before, created_at)
         VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, '{}', ?, ?)`,
      )
      .run(
        jobId,
        input.repositoryId ?? null,
        input.type,
        input.priority ?? 0,
        input.maxAttempts ?? 3,
        JSON.stringify(input.payload ?? {}),
        input.notBefore ?? null,
        now,
      );
    return jobId;
  }

  get(jobId: string): JobRecord {
    const job = this.find(jobId);
    if (!job) throw new HttpError(404, 'job not found');
    return job;
  }

  find(jobId: string): JobRecord | null {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT jobs.*, repositories.display_name AS repository_name
           FROM jobs LEFT JOIN repositories ON repositories.id = jobs.repository_id
           WHERE jobs.id = ?`,
        )
        .get(jobId),
    );
    if (!row) return null;
    return this.map(row, this.steps(jobId));
  }

  list(state: string | null, cursor: { createdAt: string; id: string } | null, limit: number): { items: JobRecord[]; nextCursor: string | null } {
    const rows = asRows(
      this.sqlite
        .prepare(
          `SELECT jobs.*, repositories.display_name AS repository_name
           FROM jobs LEFT JOIN repositories ON repositories.id = jobs.repository_id
           WHERE (? IS NULL OR jobs.state = ?)
             AND (? IS NULL OR jobs.created_at < ? OR (jobs.created_at = ? AND jobs.id < ?))
           ORDER BY jobs.created_at DESC, jobs.id DESC
           LIMIT ?`,
        )
        .all(state, state, cursor ? '1' : null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1),
    );
    const page = rows.slice(0, limit).map((row) => this.map(row, this.steps(text(row, 'id'))));
    const extra = rows[limit];
    const next = extra ? `${text(extra, 'created_at')}|${text(extra, 'id')}` : null;
    return { items: page, nextCursor: next };
  }

  claim(owner: string): JobRecord | null {
    const now = nowIso();
    const expires = new Date(Date.now() + LEASE_MS).toISOString();
    const claim = this.sqlite.transaction(() => {
      const row = asRow(
        this.sqlite
          .prepare(
            `SELECT id FROM jobs
             WHERE state = 'queued'
               AND (not_before IS NULL OR not_before <= ?)
               AND (repository_id IS NULL OR repository_id NOT IN (
                 SELECT repository_id FROM jobs WHERE state = 'running' AND repository_id IS NOT NULL
               ))
             ORDER BY priority DESC, created_at ASC
             LIMIT 1`,
          )
          .get(now),
      );
      if (!row) return null;
      const jobId = text(row, 'id');
      const updated = this.sqlite
        .prepare(
          `UPDATE jobs
           SET state = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, ?),
               lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, error_message = NULL, error_category = NULL
           WHERE id = ? AND state = 'queued'`,
        )
        .run(now, owner, expires, now, jobId);
      if (updated.changes !== 1) return null;
      return jobId;
    });
    const jobId = claim.immediate();
    return typeof jobId === 'string' ? this.get(jobId) : null;
  }

  heartbeat(jobId: string, owner: string): boolean {
    const now = nowIso();
    const expires = new Date(Date.now() + LEASE_MS).toISOString();
    const result = this.sqlite
      .prepare(
        `UPDATE jobs SET lease_expires_at = ?, heartbeat_at = ?
         WHERE id = ? AND lease_owner = ? AND state = 'running'`,
      )
      .run(expires, now, jobId, owner);
    return result.changes === 1;
  }

  reap(): number {
    const now = nowIso();
    const failed = this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'failed', error_category = 'stranded', error_message = 'lease expired before the job finished',
             finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE state = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ? AND attempt >= max_attempts`,
      )
      .run(now, now);
    const requeued = this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'queued', lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
         WHERE state = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ? AND attempt < max_attempts`,
      )
      .run(now);
    return failed.changes + requeued.changes;
  }

  pauseForStorage(jobId: string): void {
    this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'paused', error_category = 'storage', error_message = 'paused until free space is above the pool threshold',
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND state = 'running'`,
      )
      .run(jobId);
  }

  requeue(jobId: string, notBefore: string, message: string): void {
    this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'queued', not_before = ?, error_category = 'retry', error_message = ?,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND state = 'running'`,
      )
      .run(notBefore, message, jobId);
  }

  defer(jobId: string, notBefore: string, message: string): void {
    this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'queued', not_before = ?, error_category = 'rate_limit', error_message = ?,
             lease_owner = NULL, lease_expires_at = NULL, attempt = CASE WHEN attempt > 0 THEN attempt - 1 ELSE 0 END
         WHERE id = ? AND state = 'running'`,
      )
      .run(notBefore, message, jobId);
  }

  finish(jobId: string, state: 'completed' | 'partial' | 'failed' | 'cancelled', errorCategory: string | null, errorMessage: string | null): void {
    this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = ?, error_category = ?, error_message = ?, finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ?`,
      )
      .run(state, errorCategory, errorMessage, nowIso(), jobId);
  }

  pause(jobId: string): void {
    this.transition(jobId, ['queued', 'running'], 'paused');
  }

  resume(jobId: string): void {
    this.sqlite
      .prepare(
        `UPDATE jobs SET state = 'queued', error_category = NULL, not_before = NULL, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND state = 'paused'`,
      )
      .run(jobId);
  }

  cancel(jobId: string): void {
    const now = nowIso();
    const result = this.sqlite
      .prepare(
        `UPDATE jobs SET state = 'cancelled', finished_at = ?, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND state IN ('queued', 'running', 'paused')`,
      )
      .run(now, jobId);
    if (result.changes !== 1) throw new HttpError(409, 'job cannot be cancelled');
  }

  retry(jobId: string): void {
    const result = this.sqlite
      .prepare(
        `UPDATE jobs
         SET state = 'queued', attempt = 0, error_category = NULL, error_message = NULL, finished_at = NULL,
             not_before = NULL, lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND state IN ('failed', 'partial', 'cancelled')`,
      )
      .run(jobId);
    if (result.changes !== 1) throw new HttpError(409, 'job cannot be retried');
    this.sqlite
      .prepare(`UPDATE job_steps SET state = 'pending', error = NULL, finished_at = NULL WHERE job_id = ? AND state = 'failed'`)
      .run(jobId);
  }

  ensureStep(jobId: string, component: string, sequence: number): void {
    this.sqlite
      .prepare(
        `INSERT INTO job_steps (id, job_id, component, state, sequence, checkpoint_json, bytes_done)
         VALUES (?, ?, ?, 'pending', ?, '{}', 0)
         ON CONFLICT(job_id, component) DO NOTHING`,
      )
      .run(id(), jobId, component, sequence);
  }

  updateStep(jobId: string, component: string, patch: Partial<StepRecord> & { checkpoint?: Record<string, unknown> }): void {
    const current = asRow(this.sqlite.prepare(`SELECT * FROM job_steps WHERE job_id = ? AND component = ?`).get(jobId, component));
    if (!current) return;
    this.sqlite
      .prepare(
        `UPDATE job_steps
         SET state = ?, checkpoint_json = ?, bytes_done = ?, bytes_total = ?, error = ?, started_at = ?, finished_at = ?
         WHERE job_id = ? AND component = ?`,
      )
      .run(
        patch.state ?? text(current, 'state'),
        JSON.stringify(patch.checkpoint ?? jsonRecord(text(current, 'checkpoint_json'))),
        patch.bytesDone ?? integer(current, 'bytes_done'),
        patch.bytesTotal === undefined ? integerOrNull(current, 'bytes_total') : patch.bytesTotal,
        patch.error === undefined ? textOrNull(current, 'error') : patch.error,
        patch.startedAt === undefined ? textOrNull(current, 'started_at') : patch.startedAt,
        patch.finishedAt === undefined ? textOrNull(current, 'finished_at') : patch.finishedAt,
        jobId,
        component,
      );
  }

  counts(): { queued: number; running: number; failed: number; paused: number } {
    const rows = asRows(this.sqlite.prepare(`SELECT state, COUNT(*) AS count FROM jobs GROUP BY state`).all());
    const counts = { queued: 0, running: 0, failed: 0, paused: 0 };
    for (const row of rows) {
      const state = text(row, 'state');
      if (state === 'queued' || state === 'running' || state === 'failed' || state === 'paused') {
        counts[state] = integer(row, 'count');
      }
    }
    return counts;
  }

  hasReadyWork(): boolean {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT id FROM jobs WHERE state = 'queued' AND (not_before IS NULL OR not_before <= ?) LIMIT 1`,
        )
        .get(nowIso()),
    );
    return row !== null;
  }

  msUntilNextWake(): number {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT MIN(moment) AS moment FROM (
             SELECT not_before AS moment FROM jobs WHERE state = 'queued' AND not_before IS NOT NULL
             UNION ALL
             SELECT next_run_at AS moment FROM repository_sync_assignments WHERE paused = 0 AND next_run_at IS NOT NULL
           )`,
        )
        .get(),
    );
    const moment = row ? textOrNull(row, 'moment') : null;
    if (!moment) return 30_000;
    return Math.min(Math.max(new Date(moment).getTime() - Date.now(), 1_000), 60_000);
  }

  resumeStoragePauses(): number {
    const result = this.sqlite
      .prepare(
        `UPDATE jobs SET state = 'queued', error_category = NULL, error_message = NULL
         WHERE state = 'paused' AND error_category = 'storage'`,
      )
      .run();
    return result.changes;
  }

  private transition(jobId: string, from: string[], to: string): void {
    const placeholders = from.map(() => '?').join(', ');
    const result = this.sqlite
      .prepare(`UPDATE jobs SET state = ?, lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND state IN (${placeholders})`)
      .run(to, jobId, ...from);
    if (result.changes !== 1) throw new HttpError(409, 'job state does not allow that action');
  }

  private steps(jobId: string): StepRecord[] {
    return asRows(
      this.sqlite.prepare(`SELECT * FROM job_steps WHERE job_id = ? ORDER BY sequence ASC, component ASC`).all(jobId),
    ).map((row) => ({
      id: text(row, 'id'),
      component: text(row, 'component'),
      state: text(row, 'state'),
      sequence: integer(row, 'sequence'),
      checkpoint: jsonRecord(text(row, 'checkpoint_json')),
      bytesDone: integer(row, 'bytes_done'),
      bytesTotal: integerOrNull(row, 'bytes_total'),
      error: textOrNull(row, 'error'),
      startedAt: textOrNull(row, 'started_at'),
      finishedAt: textOrNull(row, 'finished_at'),
    }));
  }

  private map(row: Record<string, unknown>, steps: StepRecord[]): JobRecord {
    const type = text(row, 'type');
    const state = text(row, 'state');
    if (!isJobType(type) || !isJobState(state)) throw new Error('job row is invalid');
    return {
      id: text(row, 'id'),
      repositoryId: textOrNull(row, 'repository_id'),
      repositoryName: textOrNull(row, 'repository_name'),
      type,
      state,
      priority: integer(row, 'priority'),
      attempt: integer(row, 'attempt'),
      maxAttempts: integer(row, 'max_attempts'),
      payload: jsonRecord(text(row, 'payload_json')),
      checkpoint: jsonRecord(text(row, 'checkpoint_json')),
      errorCategory: textOrNull(row, 'error_category'),
      errorMessage: textOrNull(row, 'error_message'),
      leaseOwner: textOrNull(row, 'lease_owner'),
      leaseExpiresAt: textOrNull(row, 'lease_expires_at'),
      notBefore: textOrNull(row, 'not_before'),
      createdAt: text(row, 'created_at'),
      startedAt: textOrNull(row, 'started_at'),
      finishedAt: textOrNull(row, 'finished_at'),
      steps,
    };
  }
}

function isJobType(value: string): value is JobType {
  return (
    value === 'sync' ||
    value === 'verify' ||
    value === 'export' ||
    value === 'migrate' ||
    value === 'import' ||
    value === 'rebuild' ||
    value === 'index' ||
    value === 'backup' ||
    value === 'snapshot' ||
    value === 'dependency_archive'
  );
}

function isJobState(value: string): value is JobState {
  return value === 'queued' || value === 'running' || value === 'paused' || value === 'partial' || value === 'completed' || value === 'failed' || value === 'cancelled';
}

export function payloadRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return value;
}
