import type Database from 'better-sqlite3';
import type { SettingsService } from './settings';
import { id, nowIso } from '../rows';

export class NotificationService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly settings: SettingsService,
  ) {}

  record(kind: string, detail: Record<string, unknown>): void {
    const settings = this.settings.get().notifications;
    if (!settings.inAppEnabled && !settings.webhookEnabled) return;
    const now = nowIso();
    this.sqlite
      .prepare(
        `INSERT INTO notification_deliveries (id, rule_id, kind, status, detail_json, attempts, next_attempt_at, created_at, finished_at)
         VALUES (?, NULL, ?, 'queued', ?, 0, ?, ?, NULL)`,
      )
      .run(id(), kind, JSON.stringify(detail), now, now);
    if (settings.webhookEnabled && settings.webhookUrl) {
      void this.flushWebhook(settings.webhookUrl, settings.webhookSecret, kind, detail);
    }
  }

  async tick(): Promise<void> {
    const settings = this.settings.get().notifications;
    if (!settings.webhookEnabled || !settings.webhookUrl) return;
    const rows = this.sqlite
      .prepare(
        `SELECT id, kind, detail_json FROM notification_deliveries
         WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT 5`,
      )
      .all(nowIso()) as { id: string; kind: string; detail_json: string }[];
    for (const row of rows) {
      let detail: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(row.detail_json);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          detail = parsed as Record<string, unknown>;
        }
      } catch {
        detail = {};
      }
      await this.flushWebhook(settings.webhookUrl, settings.webhookSecret, row.kind, detail);
      this.sqlite
        .prepare(`UPDATE notification_deliveries SET status = 'sent', finished_at = ?, attempts = attempts + 1 WHERE id = ?`)
        .run(nowIso(), row.id);
    }
  }

  private async flushWebhook(url: string, secret: string | null, kind: string, detail: Record<string, unknown>): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret) headers['x-archiver-secret'] = secret;
    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind, detail, at: nowIso() }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Delivery is best-effort; rows remain for a later tick when implemented with backoff.
    }
  }
}
