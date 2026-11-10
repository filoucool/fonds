import type Database from 'better-sqlite3';
import { isRecord } from '@repo-archive/shared';
import { id, nowIso } from '../rows';

export class AuditService {
  constructor(private readonly sqlite: Database.Database) {}

  record(actor: string, kind: string, detail: Record<string, unknown> = {}): void {
    this.sqlite
      .prepare(`INSERT INTO audit_events (id, actor, kind, detail_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id(), actor, kind, JSON.stringify(sanitizeDetail(detail)), nowIso());
  }

  list(cursor: { createdAt: string; id: string } | null, limit: number): {
    items: { id: string; actor: string; kind: string; detail: Record<string, unknown>; createdAt: string }[];
    nextCursor: string | null;
  } {
    const rows = this.sqlite
      .prepare(
        `SELECT id, actor, kind, detail_json, created_at FROM audit_events
         WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(cursor ? cursor.createdAt : null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1) as {
      id: string;
      actor: string;
      kind: string;
      detail_json: string;
      created_at: string;
    }[];
    const page = rows.slice(0, limit);
    const extra = rows[limit];
    return {
      items: page.map((row) => ({
        id: row.id,
        actor: row.actor,
        kind: row.kind,
        detail: parseDetail(row.detail_json),
        createdAt: row.created_at,
      })),
      nextCursor: extra ? `${extra.created_at}|${extra.id}` : null,
    };
  }
}

function parseDetail(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string') copy[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    else copy[key] = value;
  }
  return copy;
}
