import type Database from 'better-sqlite3';
import {
  AUTH_MODES,
  DASHBOARD_WIDGET_IDS,
  isRecord,
  parseJson,
  type AppSettings,
  type AuthMode,
  type DashboardWidgetId,
  type ProviderKind,
} from '@fonds/shared';
import { defaultSettings } from '../db';
import { HttpError } from '../errors';
import { asRow, nowIso, text } from '../rows';

export class SettingsService {
  constructor(private readonly sqlite: Database.Database) {}

  get(): AppSettings {
    const row = asRow(this.sqlite.prepare(`SELECT value_json FROM settings WHERE key = 'app'`).get());
    if (!row) throw new Error('settings are not initialized');
    const parsed = hydrateSettings(normalizeSettings(parseJson(text(row, 'value_json'))));
    if (!isSettings(parsed)) throw new Error('stored settings are invalid');
    return parsed;
  }

  update(patch: Record<string, unknown>, origin: 'api' | 'internal' = 'api'): AppSettings {
    const current = this.get();
    const sanitized = sanitizePatch(patch, current);
    const rawAuth = isRecord(patch.auth) ? patch.auth : undefined;
    assertAuthSettingsPatch(current.auth, sanitized.auth, rawAuth, this.sqlite, origin);
    const next = { ...current, ...sanitized };
    if (!isSettings(next)) throw new HttpError(400, 'settings are invalid');
    this.sqlite
      .prepare(`UPDATE settings SET value_json = ?, updated_at = ? WHERE key = 'app'`)
      .run(JSON.stringify(next), nowIso());
    return next;
  }

  networkPolicy() {
    const settings = this.get();
    return {
      allowPrivateNetworks: settings.allowPrivateNetworks,
      privateNetworkExceptions: settings.privateNetworkExceptions,
      allowFileUrls: settings.allowFileUrls,
    };
  }
}

function sanitizePatch(patch: Record<string, unknown>, current: AppSettings): Partial<AppSettings> {
  const next: Partial<AppSettings> = {};
  if ('maxConcurrentJobs' in patch) next.maxConcurrentJobs = integerIn(patch.maxConcurrentJobs, 1, 16, 'maxConcurrentJobs');
  if ('allowPrivateNetworks' in patch) next.allowPrivateNetworks = bool(patch.allowPrivateNetworks, 'allowPrivateNetworks');
  if ('privateNetworkExceptions' in patch) next.privateNetworkExceptions = stringList(patch.privateNetworkExceptions);
  if ('allowFileUrls' in patch) next.allowFileUrls = bool(patch.allowFileUrls, 'allowFileUrls');
  if ('githubHosts' in patch) next.githubHosts = hostList(patch.githubHosts);
  if ('gitlabHosts' in patch) next.gitlabHosts = hostList(patch.gitlabHosts);
  if ('placementMode' in patch) {
    if (patch.placementMode !== 'most-free' && patch.placementMode !== 'default-pool' && patch.placementMode !== 'manual') {
      throw new HttpError(400, 'placementMode is invalid');
    }
    next.placementMode = patch.placementMode;
  }
  if ('defaultPoolId' in patch) next.defaultPoolId = patch.defaultPoolId === null ? null : stringValue(patch.defaultPoolId, 'defaultPoolId');
  if ('balancingEnabled' in patch) next.balancingEnabled = bool(patch.balancingEnabled, 'balancingEnabled');
  if ('balanceHighWatermarkRatio' in patch) next.balanceHighWatermarkRatio = ratio(patch.balanceHighWatermarkRatio, 'balanceHighWatermarkRatio');
  if ('balanceLowWatermarkRatio' in patch) next.balanceLowWatermarkRatio = ratio(patch.balanceLowWatermarkRatio, 'balanceLowWatermarkRatio');
  if ('defaultArchivalProfileId' in patch) {
    next.defaultArchivalProfileId = patch.defaultArchivalProfileId === null ? null : stringValue(patch.defaultArchivalProfileId, 'defaultArchivalProfileId');
  }
  if ('defaultSyncProfileId' in patch) {
    next.defaultSyncProfileId = patch.defaultSyncProfileId === null ? null : stringValue(patch.defaultSyncProfileId, 'defaultSyncProfileId');
  }
  if ('requestTimeoutMs' in patch) next.requestTimeoutMs = integerIn(patch.requestTimeoutMs, 1000, 600_000, 'requestTimeoutMs');
  if ('gitTimeoutMs' in patch) next.gitTimeoutMs = integerIn(patch.gitTimeoutMs, 1000, 24 * 60 * 60 * 1000, 'gitTimeoutMs');
  if ('maxAttempts' in patch) next.maxAttempts = integerIn(patch.maxAttempts, 1, 10, 'maxAttempts');
  if ('maxProviderPages' in patch) next.maxProviderPages = integerIn(patch.maxProviderPages, 1, 5000, 'maxProviderPages');
  if ('dashboardWidgets' in patch) next.dashboardWidgets = widgetList(patch.dashboardWidgets);
  if ('auth' in patch && isRecord(patch.auth)) next.auth = { ...current.auth, ...sanitizeAuth(patch.auth) };
  if ('gitAccess' in patch && isRecord(patch.gitAccess)) next.gitAccess = { ...current.gitAccess, ...sanitizeGitAccess(patch.gitAccess) };
  if ('search' in patch && isRecord(patch.search)) {
    next.search = {
      ...current.search,
      ...sanitizeSearch(patch.search),
      defaultIndex: {
        ...current.search.defaultIndex,
        ...(isRecord(patch.search.defaultIndex) ? sanitizeSearch({ defaultIndex: patch.search.defaultIndex }).defaultIndex : {}),
      },
    };
  }
  if ('notifications' in patch && isRecord(patch.notifications)) next.notifications = { ...current.notifications, ...sanitizeNotifications(patch.notifications) };
  if ('phase3' in patch && isRecord(patch.phase3)) next.phase3 = { ...current.phase3, ...patch.phase3 } as AppSettings['phase3'];
  return next;
}

function sanitizeAuth(value: Record<string, unknown>): Partial<AppSettings['auth']> {
  const next: Partial<AppSettings['auth']> = {};
  if ('mode' in value) {
    if (typeof value.mode !== 'string' || !AUTH_MODES.includes(value.mode as AuthMode)) throw new HttpError(400, 'auth.mode is invalid');
    next.mode = value.mode as AuthMode;
  }
  if ('sessionTtlHours' in value) next.sessionTtlHours = integerIn(value.sessionTtlHours, 1, 24 * 30, 'auth.sessionTtlHours');
  if ('requireHttpsForLogin' in value) next.requireHttpsForLogin = bool(value.requireHttpsForLogin, 'auth.requireHttpsForLogin');
  if ('oidcIssuer' in value) next.oidcIssuer = value.oidcIssuer === null ? null : stringValue(value.oidcIssuer, 'auth.oidcIssuer');
  if ('oidcClientId' in value) next.oidcClientId = value.oidcClientId === null ? null : stringValue(value.oidcClientId, 'auth.oidcClientId');
  if ('bootstrapCompleted' in value) next.bootstrapCompleted = bool(value.bootstrapCompleted, 'auth.bootstrapCompleted');
  return next;
}

function assertAuthSettingsPatch(
  current: AppSettings['auth'],
  patch: Partial<AppSettings['auth']> | undefined,
  rawAuth: Record<string, unknown> | undefined,
  sqlite: Database.Database,
  origin: 'api' | 'internal',
): void {
  if (!patch) return;
  if (origin === 'api' && rawAuth && 'bootstrapCompleted' in rawAuth) {
    throw new HttpError(400, 'auth.bootstrapCompleted cannot be changed through settings');
  }
  const nextMode = patch.mode ?? current.mode;
  if (nextMode === 'oidc') {
    throw new HttpError(400, 'oidc is not implemented');
  }
  if (patch.mode === 'local' && current.mode !== 'local') {
    const row = asRow(sqlite.prepare(`SELECT COUNT(*) AS count FROM users`).get());
    const count = row ? Number(row.count) : 0;
    if (count < 1) {
      throw new HttpError(400, 'create an admin account with POST /api/auth/bootstrap before enabling local auth');
    }
  }
}

function sanitizeGitAccess(value: Record<string, unknown>): Partial<AppSettings['gitAccess']> {
  const next: Partial<AppSettings['gitAccess']> = {};
  if ('httpEnabled' in value) next.httpEnabled = bool(value.httpEnabled, 'gitAccess.httpEnabled');
  if ('sshEnabled' in value) next.sshEnabled = bool(value.sshEnabled, 'gitAccess.sshEnabled');
  if ('publicBaseUrl' in value) next.publicBaseUrl = value.publicBaseUrl === null ? null : stringValue(value.publicBaseUrl, 'gitAccess.publicBaseUrl');
  if ('sshHost' in value) next.sshHost = value.sshHost === null ? null : stringValue(value.sshHost, 'gitAccess.sshHost');
  if ('sshPort' in value) next.sshPort = integerIn(value.sshPort, 1, 65535, 'gitAccess.sshPort');
  if ('advertiseArchiveRefs' in value) next.advertiseArchiveRefs = bool(value.advertiseArchiveRefs, 'gitAccess.advertiseArchiveRefs');
  return next;
}

function sanitizeSearch(value: Record<string, unknown>): Partial<AppSettings['search']> {
  const next: Partial<AppSettings['search']> = {};
  if ('globalIndexingEnabled' in value) next.globalIndexingEnabled = bool(value.globalIndexingEnabled, 'search.globalIndexingEnabled');
  if ('indexDiskBudgetBytes' in value) {
    next.indexDiskBudgetBytes =
      value.indexDiskBudgetBytes === null ? null : integerIn(value.indexDiskBudgetBytes, 1_000_000, 10_000_000_000_000, 'search.indexDiskBudgetBytes');
  }
  if ('defaultIndex' in value && isRecord(value.defaultIndex)) {
    const raw = value.defaultIndex;
    next.defaultIndex = {
      metadata: raw.metadata !== false,
      filenames: raw.filenames === true,
      sourceText: raw.sourceText === true,
      maxFileBytes: typeof raw.maxFileBytes === 'number' ? raw.maxFileBytes : 256 * 1024,
      excludeGlobs: Array.isArray(raw.excludeGlobs) ? raw.excludeGlobs.filter((entry): entry is string => typeof entry === 'string') : [],
    };
  }
  return next;
}

// emailEnabled is persisted for forward compatibility; NotificationService ignores it until SMTP delivery exists.
function sanitizeNotifications(value: Record<string, unknown>): Partial<AppSettings['notifications']> {
  const next: Partial<AppSettings['notifications']> = {};
  if ('inAppEnabled' in value) next.inAppEnabled = bool(value.inAppEnabled, 'notifications.inAppEnabled');
  if ('emailEnabled' in value) next.emailEnabled = bool(value.emailEnabled, 'notifications.emailEnabled');
  if ('webhookEnabled' in value) next.webhookEnabled = bool(value.webhookEnabled, 'notifications.webhookEnabled');
  if ('webhookUrl' in value) next.webhookUrl = value.webhookUrl === null ? null : stringValue(value.webhookUrl, 'notifications.webhookUrl');
  if ('webhookSecret' in value) next.webhookSecret = value.webhookSecret === null ? null : stringValue(value.webhookSecret, 'notifications.webhookSecret');
  return next;
}

function hydrateSettings(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const poolId = typeof value.defaultPoolId === 'string' ? value.defaultPoolId : 'pool-default';
  const defaults = defaultSettings(poolId);
  return {
    ...defaults,
    ...value,
    auth: { ...defaults.auth, ...(isRecord(value.auth) ? value.auth : {}) },
    gitAccess: { ...defaults.gitAccess, ...(isRecord(value.gitAccess) ? value.gitAccess : {}) },
    search: {
      ...defaults.search,
      ...(isRecord(value.search) ? value.search : {}),
      defaultIndex: {
        ...defaults.search.defaultIndex,
        ...(isRecord(value.search) && isRecord(value.search.defaultIndex) ? value.search.defaultIndex : {}),
      },
    },
    notifications: { ...defaults.notifications, ...(isRecord(value.notifications) ? value.notifications : {}) },
    phase3: { ...defaults.phase3, ...(isRecord(value.phase3) ? value.phase3 : {}) },
  };
}

function normalizeSettings(value: unknown): unknown {
  if (!isRecord(value) || Array.isArray(value.dashboardWidgets)) return value;
  return { ...value, dashboardWidgets: [...DASHBOARD_WIDGET_IDS] };
}

export function isSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false;
  return (
    inRange(value.maxConcurrentJobs, 1, 16) &&
    typeof value.allowPrivateNetworks === 'boolean' &&
    stringArray(value.privateNetworkExceptions) &&
    typeof value.allowFileUrls === 'boolean' &&
    stringArray(value.githubHosts) &&
    stringArray(value.gitlabHosts) &&
    (value.placementMode === 'most-free' || value.placementMode === 'default-pool' || value.placementMode === 'manual') &&
    (value.defaultPoolId === null || typeof value.defaultPoolId === 'string') &&
    typeof value.balancingEnabled === 'boolean' &&
    ratioOk(value.balanceHighWatermarkRatio) &&
    ratioOk(value.balanceLowWatermarkRatio) &&
    (value.defaultArchivalProfileId === null || typeof value.defaultArchivalProfileId === 'string') &&
    (value.defaultSyncProfileId === null || typeof value.defaultSyncProfileId === 'string') &&
    inRange(value.requestTimeoutMs, 1000, 600_000) &&
    inRange(value.gitTimeoutMs, 1000, 24 * 60 * 60 * 1000) &&
    inRange(value.maxAttempts, 1, 10) &&
    inRange(value.maxProviderPages, 1, 5000) &&
    widgetIds(value.dashboardWidgets) &&
    authOk(value.auth) &&
    gitAccessOk(value.gitAccess) &&
    searchOk(value.search) &&
    notificationsOk(value.notifications) &&
    phase3Ok(value.phase3)
  );
}

function phase3Ok(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isRecord(value.backups) || !isRecord(value.snapshots) || !isRecord(value.dependencies) || !isRecord(value.selfPreservation)) return false;
  return typeof value.backups.enabled === 'boolean' && typeof value.snapshots.onChange === 'boolean';
}

function authOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.mode === 'string' &&
    AUTH_MODES.includes(value.mode as AuthMode) &&
    inRange(value.sessionTtlHours, 1, 24 * 30) &&
    typeof value.requireHttpsForLogin === 'boolean' &&
    (value.oidcIssuer === null || typeof value.oidcIssuer === 'string') &&
    (value.oidcClientId === null || typeof value.oidcClientId === 'string') &&
    typeof value.bootstrapCompleted === 'boolean'
  );
}

function gitAccessOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.httpEnabled === 'boolean' &&
    typeof value.sshEnabled === 'boolean' &&
    (value.publicBaseUrl === null || typeof value.publicBaseUrl === 'string') &&
    (value.sshHost === null || typeof value.sshHost === 'string') &&
    inRange(value.sshPort, 1, 65535) &&
    typeof value.advertiseArchiveRefs === 'boolean'
  );
}

function searchOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.globalIndexingEnabled !== 'boolean') return false;
  if (!(value.indexDiskBudgetBytes === null || (typeof value.indexDiskBudgetBytes === 'number' && value.indexDiskBudgetBytes > 0))) return false;
  if (!isRecord(value.defaultIndex)) return false;
  return (
    typeof value.defaultIndex.metadata === 'boolean' &&
    typeof value.defaultIndex.filenames === 'boolean' &&
    typeof value.defaultIndex.sourceText === 'boolean' &&
    typeof value.defaultIndex.maxFileBytes === 'number'
  );
}

function notificationsOk(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.inAppEnabled === 'boolean' &&
    typeof value.emailEnabled === 'boolean' &&
    typeof value.webhookEnabled === 'boolean' &&
    (value.webhookUrl === null || typeof value.webhookUrl === 'string') &&
    (value.webhookSecret === null || typeof value.webhookSecret === 'string')
  );
}

export function providerKind(value: string): ProviderKind {
  if (value === 'github' || value === 'gitlab' || value === 'git') return value;
  throw new HttpError(400, 'provider is invalid');
}

function integerIn(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be boolean`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new HttpError(400, `${label} is invalid`);
  return value.trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new HttpError(400, 'expected a list of strings');
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function hostList(value: unknown): string[] {
  return stringList(value).map((host) => host.toLowerCase());
}

function widgetList(value: unknown): DashboardWidgetId[] {
  if (!widgetIds(value)) throw new HttpError(400, 'dashboardWidgets is invalid');
  return [...new Set(value)];
}

function widgetIds(value: unknown): value is DashboardWidgetId[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && isWidget(entry));
}

function isWidget(value: string): value is DashboardWidgetId {
  for (const id of DASHBOARD_WIDGET_IDS) {
    if (id === value) return true;
  }
  return false;
}

function ratio(value: unknown, label: string): number {
  if (typeof value !== 'number' || value <= 0 || value > 1) throw new HttpError(400, `${label} must be between 0 and 1`);
  return value;
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function ratioOk(value: unknown): boolean {
  return typeof value === 'number' && value > 0 && value <= 1;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
