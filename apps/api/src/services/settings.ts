import type Database from 'better-sqlite3';
import { DASHBOARD_WIDGET_IDS, isRecord, parseJson, type AppSettings, type DashboardWidgetId, type ProviderKind } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { asRow, nowIso, text } from '../rows';

export class SettingsService {
  constructor(private readonly sqlite: Database.Database) {}

  get(): AppSettings {
    const row = asRow(this.sqlite.prepare(`SELECT value_json FROM settings WHERE key = 'app'`).get());
    if (!row) throw new Error('settings are not initialized');
    const parsed = normalizeSettings(parseJson(text(row, 'value_json')));
    if (!isSettings(parsed)) throw new Error('stored settings are invalid');
    return parsed;
  }

  update(patch: Record<string, unknown>): AppSettings {
    const next = { ...this.get(), ...sanitizePatch(patch) };
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

function sanitizePatch(patch: Record<string, unknown>): Partial<AppSettings> {
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
  return next;
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
    widgetIds(value.dashboardWidgets)
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
