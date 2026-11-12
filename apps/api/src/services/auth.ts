import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthMode, AccessTokenScope } from '@fonds/shared';
import { HttpError } from '../errors';
import { asRow, id, nowIso, text } from '../rows';
import type { SettingsService } from './settings';
import type { AuditService } from './audit';
import { hashPassword, hashToken, randomToken, tokenHint, verifyPassword } from './crypto';

export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

export interface SessionContext {
  sessionId: string;
  user: SessionUser;
  csrfToken: string;
  expiresAt: string;
}

export class AuthService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  mode(): AuthMode {
    return this.settings.get().auth.mode;
  }

  requiresAuth(): boolean {
    return this.mode() !== 'trusted';
  }

  userCount(): number {
    const row = asRow(this.sqlite.prepare(`SELECT COUNT(*) AS count FROM users`).get());
    return row ? Number(row.count) : 0;
  }

  bootstrap(username: string, password: string): { session: SessionContext; token: string } {
    const auth = this.settings.get().auth;
    if (auth.bootstrapCompleted && this.userCount() > 0) throw new HttpError(403, 'bootstrap is already complete');
    if (password.length < 12) throw new HttpError(400, 'password must be at least 12 characters');
    const userId = id();
    const now = nowIso();
    this.sqlite
      .prepare(`INSERT INTO users (id, username, password_hash, role, totp_secret, created_at, updated_at) VALUES (?, ?, ?, 'admin', NULL, ?, ?)`)
      .run(userId, username.trim(), hashPassword(password), now, now);
    this.settings.update({
      auth: { ...auth, mode: 'local', bootstrapCompleted: true },
    });
    this.audit.record(username, 'auth.bootstrap', {});
    return this.createSession(userId);
  }

  login(username: string, password: string): { session: SessionContext; token: string } {
    const row = asRow(
      this.sqlite.prepare(`SELECT id, username, password_hash, role FROM users WHERE username = ? COLLATE NOCASE`).get(username.trim()),
    );
    if (!row) throw new HttpError(401, 'invalid credentials');
    if (!verifyPassword(password, text(row, 'password_hash'))) throw new HttpError(401, 'invalid credentials');
    this.audit.record(text(row, 'username'), 'auth.login', {});
    return this.createSession(text(row, 'id'));
  }

  logout(sessionId: string): void {
    this.sqlite.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  sessionFromToken(token: string): SessionContext | null {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT sessions.id, sessions.csrf_token, sessions.expires_at, users.id AS user_id, users.username, users.role
           FROM sessions JOIN users ON users.id = sessions.user_id
           WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        )
        .get(hashToken(token), nowIso()),
    );
    if (!row) return null;
    this.sqlite.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), text(row, 'id'));
    return {
      sessionId: text(row, 'id'),
      user: { id: text(row, 'user_id'), username: text(row, 'username'), role: text(row, 'role') },
      csrfToken: text(row, 'csrf_token'),
      expiresAt: text(row, 'expires_at'),
    };
  }

  resolveAccessToken(token: string): { userId: string; scopes: AccessTokenScope[] } | null {
    const row = asRow(
      this.sqlite
        .prepare(
          `SELECT user_id, scopes_json, expires_at, revoked_at FROM access_tokens WHERE token_hash = ?`,
        )
        .get(hashToken(token)),
    );
    if (!row || row.revoked_at) return null;
    if (row.expires_at && String(row.expires_at) <= nowIso()) return null;
    const scopes = parseScopes(row.scopes_json);
    this.sqlite.prepare(`UPDATE access_tokens SET last_used_at = ? WHERE token_hash = ?`).run(nowIso(), hashToken(token));
    return { userId: text(row, 'user_id'), scopes };
  }

  createAccessToken(userId: string, label: string, scopes: AccessTokenScope[], expiresAt: string | null): { id: string; token: string; hint: string } {
    const token = `ra_${randomToken(24)}`;
    const tokenId = id();
    this.sqlite
      .prepare(
        `INSERT INTO access_tokens (id, user_id, label, token_hash, hint, scopes_json, expires_at, revoked_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(tokenId, userId, label.trim(), hashToken(token), tokenHint(token), JSON.stringify(scopes), expiresAt, nowIso());
    this.audit.record(userId, 'access_token.created', { label });
    return { id: tokenId, token, hint: tokenHint(token) };
  }

  listAccessTokens(userId: string) {
    return (
      this.sqlite
        .prepare(
          `SELECT id, label, hint, scopes_json, expires_at, revoked_at, created_at, last_used_at FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC`,
        )
        .all(userId) as Record<string, unknown>[]
    ).map((row) => ({
      id: text(row, 'id'),
      label: text(row, 'label'),
      hint: text(row, 'hint'),
      scopes: parseScopes(row.scopes_json),
      expiresAt: row.expires_at === null ? null : text(row, 'expires_at'),
      revokedAt: row.revoked_at === null ? null : text(row, 'revoked_at'),
      createdAt: text(row, 'created_at'),
      lastUsedAt: row.last_used_at === null ? null : text(row, 'last_used_at'),
    }));
  }

  revokeAccessToken(userId: string, tokenId: string): void {
    const result = this.sqlite.prepare(`UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(nowIso(), tokenId, userId);
    if (result.changes === 0) throw new HttpError(404, 'access token not found');
    this.audit.record(userId, 'access_token.revoked', { tokenId });
  }

  addSshKey(userId: string, label: string, publicKey: string): { id: string; fingerprint: string } {
    const normalized = publicKey.trim();
    if (!normalized.includes('ssh-')) throw new HttpError(400, 'public key is invalid');
    const fingerprint = sshFingerprint(normalized);
    const keyId = id();
    try {
      this.sqlite
        .prepare(`INSERT INTO ssh_public_keys (id, user_id, label, public_key, fingerprint, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`)
        .run(keyId, userId, label.trim(), normalized, fingerprint, nowIso());
    } catch {
      throw new HttpError(409, 'ssh key already registered');
    }
    this.audit.record(userId, 'ssh_key.added', { fingerprint });
    return { id: keyId, fingerprint };
  }

  listSshKeys(userId: string) {
    return (
      this.sqlite
        .prepare(`SELECT id, label, fingerprint, created_at, last_used_at FROM ssh_public_keys WHERE user_id = ? ORDER BY created_at DESC`)
        .all(userId) as Record<string, unknown>[]
    ).map((row) => ({
      id: text(row, 'id'),
      label: text(row, 'label'),
      fingerprint: text(row, 'fingerprint'),
      createdAt: text(row, 'created_at'),
      lastUsedAt: row.last_used_at === null ? null : text(row, 'last_used_at'),
    }));
  }

  deleteSshKey(userId: string, keyId: string): void {
    const result = this.sqlite.prepare(`DELETE FROM ssh_public_keys WHERE id = ? AND user_id = ?`).run(keyId, userId);
    if (result.changes === 0) throw new HttpError(404, 'ssh key not found');
    this.audit.record(userId, 'ssh_key.deleted', { keyId });
  }

  findSshKeyByFingerprint(fingerprint: string): { id: string; userId: string; publicKey: string } | null {
    const row = asRow(this.sqlite.prepare(`SELECT id, user_id, public_key FROM ssh_public_keys WHERE fingerprint = ?`).get(fingerprint));
    if (!row) return null;
    return { id: text(row, 'id'), userId: text(row, 'user_id'), publicKey: text(row, 'public_key') };
  }

  findSshKeyByPublicKey(publicKey: string): { id: string; userId: string } | null {
    const normalized = publicKey.trim();
    const row = asRow(this.sqlite.prepare(`SELECT id, user_id FROM ssh_public_keys WHERE public_key = ?`).get(normalized));
    if (!row) return null;
    return { id: text(row, 'id'), userId: text(row, 'user_id') };
  }

  touchSshKey(keyId: string): void {
    this.sqlite.prepare(`UPDATE ssh_public_keys SET last_used_at = ? WHERE id = ?`).run(nowIso(), keyId);
  }

  private createSession(userId: string): { session: SessionContext; token: string } {
    const userRow = asRow(this.sqlite.prepare(`SELECT id, username, role FROM users WHERE id = ?`).get(userId));
    if (!userRow) throw new HttpError(500, 'user record missing');
    const token = randomToken(32);
    const sessionId = id();
    const csrf = randomToken(16);
    const ttlHours = this.settings.get().auth.sessionTtlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const now = nowIso();
    this.sqlite
      .prepare(`INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(sessionId, userId, hashToken(token), csrf, expiresAt, now, now);
    return {
      token,
      session: {
        sessionId,
        user: { id: text(userRow, 'id'), username: text(userRow, 'username'), role: text(userRow, 'role') },
        csrfToken: csrf,
        expiresAt,
      },
    };
  }
}

function parseScopes(raw: unknown): AccessTokenScope[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const allowed: AccessTokenScope[] = [];
    for (const entry of parsed) {
      if (entry === 'api' || entry === 'git_push' || entry === 'git_fetch') allowed.push(entry);
    }
    return allowed;
  } catch {
    return [];
  }
}

function sshFingerprint(publicKey: string): string {
  const parts = publicKey.trim().split(/\s+/);
  const encoded = parts.length > 1 ? parts[1] : parts[0];
  if (!encoded) throw new HttpError(400, 'public key is invalid');
  const digest = createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

export function normalizeSshFingerprint(value: string): string {
  return value.startsWith('SHA256:') ? value : `SHA256:${value}`;
}
