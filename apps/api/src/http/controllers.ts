import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isRecord, type ExportFormat } from '@fonds/shared';
import { APP_VERSION } from '@fonds/shared';
import { MaintenanceService } from '../container';
import { HttpError } from '../errors';
import { APP_CONFIG } from './tokens';
import type { AppConfig } from '../config';
import { defaultGitRef, readBlob, readCommits, listTree } from '../services/browse';
import { CatalogService } from '../services/catalog';
import { ExportService } from '../services/exporter';
import { IntegrityService } from '../services/integrity';
import { JobsService } from '../services/jobs';
import { providerKind, SettingsService } from '../services/settings';
import { StorageService } from '../services/storage';
import { WorkerService } from '../services/worker';

@Controller('api')
export class ApiController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(IntegrityService) private readonly integrity: IntegrityService,
    @Inject(ExportService) private readonly exporter: ExportService,
    @Inject(WorkerService) private readonly worker: WorkerService,
    @Inject(MaintenanceService) private readonly maintenance: MaintenanceService,
  ) {}

  @Get('health')
  health() {
    return { ok: true, version: this.config.version || APP_VERSION, time: new Date().toISOString() };
  }

  @Get('dashboard')
  dashboard() {
    return this.catalog.dashboard();
  }

  @Get('settings')
  getSettings() {
    return { settings: this.settings.get() };
  }

  @Patch('settings')
  patchSettings(@Body() body: unknown) {
    if (!isRecord(body)) throw new HttpError(400, 'settings body is invalid');
    const settings = this.settings.update(body);
    this.worker.wake();
    return { settings };
  }

  @Get('repositories')
  listRepositories(@Query() query: Record<string, string | undefined>) {
    return this.catalog.list({
      limit: numberQuery(query.limit),
      cursor: query.cursor ?? null,
      q: query.q ?? null,
      status: query.status ?? null,
      provider: query.provider ?? null,
      categoryId: query.categoryId ?? null,
      tagId: query.tagId ?? null,
      collectionId: query.collectionId ?? null,
      storagePoolId: query.storagePoolId ?? null,
      sort: query.sort === 'name' || query.sort === 'size' ? query.sort : 'updated',
      includeDeleted: query.includeDeleted === 'true',
    });
  }

  @Post('repositories')
  @HttpCode(201)
  async createRepository(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.url !== 'string') throw new HttpError(400, 'url is required');
    const result = await this.catalog.create({
      url: input.url,
      displayName: optionalString(input.displayName),
      profileId: optionalString(input.profileId),
      syncProfileId: optionalString(input.syncProfileId),
      categoryId: optionalString(input.categoryId),
      tagIds: stringArray(input.tagIds),
    });
    this.worker.wake();
    return result;
  }

  @Post('repositories/import')
  async importRepositories(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.text !== 'string' || (input.format !== 'text' && input.format !== 'csv')) {
      throw new HttpError(400, 'text and format are required');
    }
    const result = await this.catalog.importText({
      text: input.text,
      format: input.format,
      profileId: optionalString(input.profileId),
      syncProfileId: optionalString(input.syncProfileId),
      categoryId: optionalString(input.categoryId),
    });
    this.worker.wake();
    return result;
  }

  @Post('repositories/bulk')
  bulk(@Body() body: unknown) {
    const input = record(body);
    const ids = stringArray(input.ids) ?? [];
    if (ids.length === 0 || ids.length > 500) throw new HttpError(400, 'ids must contain 1 to 500 repositories');
    if (input.action === 'delete') {
      return { jobIds: [], deletedIds: this.catalog.softDelete(ids, input.confirm === true), exportIds: [] };
    }
    if (input.action !== 'sync' && input.action !== 'verify' && input.action !== 'export') {
      throw new HttpError(400, 'action is invalid');
    }
    const jobIds: string[] = [];
    const exportIds: string[] = [];
    for (const repositoryId of ids) {
      if (input.action === 'sync') jobIds.push(this.catalog.enqueueSync(repositoryId));
      if (input.action === 'verify') jobIds.push(this.catalog.enqueueTyped(repositoryId, 'verify', {}));
      if (input.action === 'export') {
        const format = exportFormat(input.exportFormat);
        const created = this.exporter.create(repositoryId, format);
        exportIds.push(created.id);
        jobIds.push(this.catalog.enqueueTyped(repositoryId, 'export', { exportId: created.id }));
      }
    }
    this.worker.wake();
    return { jobIds, deletedIds: [], exportIds };
  }

  @Get('repositories/:id')
  getRepository(@Param('id') id: string) {
    return this.catalog.get(id);
  }

  @Patch('repositories/:id')
  patchRepository(@Param('id') id: string, @Body() body: unknown) {
    return this.catalog.update(id, record(body));
  }

  @Delete('repositories/:id')
  deleteRepository(@Param('id') id: string, @Query('confirm') confirm?: string) {
    this.catalog.softDelete([id], confirm === 'true');
    return { deletedAt: new Date().toISOString() };
  }

  @Post('repositories/:id/restore')
  restore(@Param('id') id: string) {
    return this.catalog.restore(id);
  }

  @Post('repositories/:id/purge')
  async purge(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    if (typeof input.confirmName !== 'string') throw new HttpError(400, 'confirmName is required');
    await this.catalog.purge(id, input.confirmName);
    return { purged: true };
  }

  @Post('repositories/:id/sync')
  sync(@Param('id') id: string) {
    const jobId = this.catalog.enqueueSync(id);
    this.worker.wake();
    return { jobId };
  }

  @Post('repositories/:id/verify')
  verify(@Param('id') id: string) {
    const jobId = this.catalog.enqueueTyped(id, 'verify', {});
    this.worker.wake();
    return { jobId };
  }

  @Post('repositories/:id/export')
  exportRepo(@Param('id') id: string, @Body() body: unknown) {
    const format = exportFormat(record(body).format);
    const created = this.exporter.create(id, format);
    const jobId = this.catalog.enqueueTyped(id, 'export', { exportId: created.id });
    this.worker.wake();
    return { jobId, exportId: created.id };
  }

  @Get('repositories/:id/refs')
  async refs(@Param('id') id: string) {
    const repo = this.catalog.require(id);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const { readFile } = await import('node:fs/promises');
    const { parseManifest } = await import('@fonds/archive-format');
    const { parseJson } = await import('@fonds/shared');
    try {
      const manifest = parseManifest(parseJson(await readFile(located.paths.manifest, 'utf8')));
      return {
        current: manifest.refs.current.map(shortRef),
        archived: manifest.refs.archived.map((ref) => ({ ...shortRef(ref), reason: ref.reason, recordedAt: ref.recordedAt, sourceRef: ref.sourceRef })),
      };
    } catch {
      return { current: [], archived: [] };
    }
  }

  @Get('repositories/:id/commits')
  commits(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    const repo = this.catalog.require(id);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    const ref = defaultGitRef(repo.defaultBranch, query.ref);
    return readCommits(located.paths.gitDir, ref, query.cursor ?? null, numberQuery(query.limit) ?? 30);
  }

  @Get('repositories/:id/tree')
  tree(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    const repo = this.catalog.require(id);
    const ref = defaultGitRef(repo.defaultBranch, query.ref);
    return listTree(this.gitDir(id, query.space), ref, query.path ?? '').then((entries) => ({ ref, path: query.path ?? '', entries }));
  }

  @Get('repositories/:id/blob')
  blob(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    const repo = this.catalog.require(id);
    return readBlob(this.gitDir(id, query.space), defaultGitRef(repo.defaultBranch, query.ref), query.path ?? '');
  }

  @Get('repositories/:id/blob/raw')
  async blobRaw(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Res() reply: FastifyReply) {
    const repo = this.catalog.require(id);
    const blob = await readBlob(this.gitDir(id, query.space), defaultGitRef(repo.defaultBranch, query.ref), query.path ?? '');
    reply.header('content-type', 'text/plain; charset=utf-8');
    return reply.send(blob.content ?? '');
  }

  @Get('repositories/:id/components')
  components(@Param('id') id: string) {
    return { items: this.catalog.components(id) };
  }

  @Get('repositories/:id/events')
  events(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    return this.catalog.events(id, query.cursor ?? null, numberQuery(query.limit) ?? 50);
  }

  @Get('repositories/:id/issues')
  issues(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    return this.catalog.records(id, 'issue', query.cursor ?? null, numberQuery(query.limit) ?? 30);
  }

  @Get('repositories/:id/pulls')
  pulls(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    return this.catalog.records(id, 'pull', query.cursor ?? null, numberQuery(query.limit) ?? 30);
  }

  @Get('repositories/:id/discussions')
  discussions(@Param('id') id: string, @Query() query: Record<string, string | undefined>) {
    return this.catalog.records(id, 'discussion', query.cursor ?? null, numberQuery(query.limit) ?? 30);
  }

  @Get('repositories/:id/comments')
  comments(@Param('id') id: string, @Query() query: Record<string, string | string[] | undefined>) {
    const kind = query.kind === 'pull' ? 'pull_comment' : 'issue_comment';
    const raw = query.parent;
    const parents = Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : typeof raw === 'string' && raw.length > 0 ? [raw] : [];
    return { items: this.catalog.children(id, kind, parents) };
  }

  @Get('repositories/:id/lfs')
  async lfs(@Param('id') id: string) {
    return { items: await this.catalog.lfsObjects(id) };
  }

  @Get('repositories/:id/releases')
  releases(@Param('id') id: string) {
    return { items: this.catalog.releases(id) };
  }

  @Get('repositories/:id/assets/:assetId')
  asset(@Param('id') id: string, @Param('assetId') assetId: string, @Res() reply: FastifyReply) {
    const file = this.catalog.assetFile(id, assetId);
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(createReadStream(file.absolute));
  }

  @Get('repositories/:id/integrity')
  integrityRuns(@Param('id') id: string) {
    return { items: this.integrity.list(id) };
  }

  @Get('archival-profiles')
  profiles() {
    return { items: this.catalog.profiles() };
  }

  @Post('archival-profiles')
  createProfile(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string') throw new HttpError(400, 'name is required');
    return this.catalog.createProfile({ name: input.name, description: optionalString(input.description), config: input.config });
  }

  @Get('archival-profiles/:id')
  profile(@Param('id') id: string) {
    return this.catalog.profile(id);
  }

  @Patch('archival-profiles/:id')
  patchProfile(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.catalog.updateProfile(id, { name: optionalString(input.name), description: optionalString(input.description), config: input.config });
  }

  @Delete('archival-profiles/:id')
  deleteProfile(@Param('id') id: string) {
    this.catalog.deleteProfile(id);
    return { deleted: true };
  }

  @Get('sync-profiles')
  syncProfiles() {
    return { items: this.catalog.syncProfiles() };
  }

  @Post('sync-profiles')
  createSync(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string' || typeof input.timezone !== 'string') throw new HttpError(400, 'name and timezone are required');
    return this.catalog.createSyncProfile({ name: input.name, description: optionalString(input.description), schedule: input.schedule, timezone: input.timezone, paused: input.paused === true });
  }

  @Get('sync-profiles/:id')
  syncProfile(@Param('id') id: string) {
    return this.catalog.syncProfile(id);
  }

  @Patch('sync-profiles/:id')
  patchSync(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.catalog.updateSyncProfile(id, {
      name: optionalString(input.name),
      description: optionalString(input.description),
      schedule: input.schedule,
      timezone: optionalString(input.timezone),
      paused: typeof input.paused === 'boolean' ? input.paused : undefined,
    });
  }

  @Delete('sync-profiles/:id')
  deleteSync(@Param('id') id: string) {
    this.catalog.deleteSyncProfile(id);
    return { deleted: true };
  }

  @Get('categories')
  categories() {
    return { items: this.catalog.categories() };
  }

  @Post('categories')
  createCategory(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string') throw new HttpError(400, 'name is required');
    return this.catalog.createCategory(input.name, optionalString(input.description) ?? '');
  }

  @Patch('categories/:id')
  patchCategory(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.catalog.updateCategory(id, { name: optionalString(input.name), description: optionalString(input.description) });
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    this.catalog.deleteCategory(id);
    return { deleted: true };
  }

  @Get('tags')
  tags() {
    return { items: this.catalog.tags() };
  }

  @Post('tags')
  createTag(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string') throw new HttpError(400, 'name is required');
    return this.catalog.createTag(input.name);
  }

  @Delete('tags/:id')
  deleteTag(@Param('id') id: string) {
    this.catalog.deleteTag(id);
    return { deleted: true };
  }

  @Get('collections')
  collections() {
    return { items: this.catalog.collections() };
  }

  @Post('collections')
  createCollection(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string') throw new HttpError(400, 'name is required');
    return this.catalog.createCollection(input.name, optionalString(input.description) ?? '');
  }

  @Patch('collections/:id')
  patchCollection(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.catalog.updateCollection(id, { name: optionalString(input.name), description: optionalString(input.description) });
  }

  @Delete('collections/:id')
  deleteCollection(@Param('id') id: string) {
    this.catalog.deleteCollection(id);
    return { deleted: true };
  }

  @Put('collections/:id/repositories')
  setMembers(@Param('id') id: string, @Body() body: unknown) {
    this.catalog.setCollectionMembers(id, stringArray(record(body).repositoryIds) ?? []);
    return { updated: true };
  }

  @Get('jobs')
  listJobs(@Query() query: Record<string, string | undefined>) {
    const cursor = query.cursor ? decodeJobCursor(query.cursor) : null;
    const page = this.jobs.list(query.state ?? null, cursor, numberQuery(query.limit) ?? 50);
    return page;
  }

  @Get('jobs/:id')
  job(@Param('id') id: string) {
    return this.jobs.get(id);
  }

  @Post('jobs/:id/pause')
  pause(@Param('id') id: string) {
    this.jobs.pause(id);
    return this.jobs.get(id);
  }

  @Post('jobs/:id/resume')
  resumeJob(@Param('id') id: string) {
    this.jobs.resume(id);
    this.worker.wake();
    return this.jobs.get(id);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    this.jobs.cancel(id);
    return this.jobs.get(id);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    this.jobs.retry(id);
    this.worker.wake();
    return this.jobs.get(id);
  }

  @Get('storage/pools')
  pools() {
    return { items: this.storage.list() };
  }

  @Get('storage/path-candidates')
  storagePathCandidates() {
    return { items: this.storage.pathCandidates() };
  }

  @Post('storage/pools')
  createPool(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string' || typeof input.rootPath !== 'string') throw new HttpError(400, 'name and rootPath are required');
    const threshold = typeof input.freeSpaceThresholdBytes === 'number' ? input.freeSpaceThresholdBytes : 1024 * 1024 * 1024;
    return this.storage.create({
      name: input.name,
      rootPath: input.rootPath,
      freeSpaceThresholdBytes: threshold,
      acceptNew: input.acceptNew !== false,
      placementWeight: typeof input.placementWeight === 'number' ? input.placementWeight : 1,
    });
  }

  @Patch('storage/pools/:id')
  patchPool(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    return this.storage.update(id, {
      name: optionalString(input.name),
      freeSpaceThresholdBytes: typeof input.freeSpaceThresholdBytes === 'number' ? input.freeSpaceThresholdBytes : undefined,
      acceptNew: typeof input.acceptNew === 'boolean' ? input.acceptNew : undefined,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
      placementWeight: typeof input.placementWeight === 'number' ? input.placementWeight : undefined,
    });
  }

  @Post('storage/migrate')
  migrate(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.repositoryId !== 'string' || typeof input.destinationPoolId !== 'string') {
      throw new HttpError(400, 'repositoryId and destinationPoolId are required');
    }
    const jobId = this.catalog.enqueueTyped(input.repositoryId, 'migrate', { destinationPoolId: input.destinationPoolId });
    this.worker.wake();
    return { jobId };
  }

  @Get('credentials')
  credentials() {
    return { items: this.catalog.credentials() };
  }

  @Post('credentials')
  createCredential(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.provider !== 'string' || typeof input.label !== 'string' || typeof input.token !== 'string') {
      throw new HttpError(400, 'provider, label, and token are required');
    }
    return this.catalog.addCredential(providerKind(input.provider), input.label, input.token);
  }

  @Delete('credentials/:id')
  deleteCredential(@Param('id') id: string) {
    this.catalog.deleteCredential(id);
    return { deleted: true };
  }

  @Post('catalog/rebuild')
  rebuild() {
    const jobId = this.jobs.enqueue({ type: 'rebuild', priority: 1 });
    this.worker.wake();
    return { jobId };
  }

  @Post('catalog/import-local')
  importLocal(@Body() body: unknown) {
    const sourcePath = record(body).sourcePath;
    if (typeof sourcePath !== 'string') throw new HttpError(400, 'sourcePath is required');
    const jobId = this.jobs.enqueue({ type: 'import', payload: { sourcePath } });
    this.worker.wake();
    return { jobId };
  }

  @Post('maintenance/sqlite-backup')
  backup() {
    return this.maintenance.backup();
  }

  @Get('exports/:id')
  exportRecord(@Param('id') id: string) {
    return this.exporter.get(id);
  }

  @Get('exports/:id/download')
  exportDownload(@Param('id') id: string, @Res() reply: FastifyReply) {
    const file = this.exporter.download(id);
    if (!file.file) throw new HttpError(400, 'directory exports are on disk; package or bundle exports are downloadable');
    reply.header('content-disposition', `attachment; filename="${path.basename(file.file)}"`);
    return reply.send(createReadStream(file.file));
  }

  @Get('inventory')
  async inventory() {
    const candidates = [path.resolve(process.cwd(), 'docs/dependency-inventory.json'), path.resolve(__dirname, '../../../../docs/dependency-inventory.json')];
    for (const candidate of candidates) {
      try {
        return JSON.parse(await readFile(candidate, 'utf8')) as unknown;
      } catch {
        continue;
      }
    }
    return { applicationVersion: APP_VERSION, packages: [], images: [], note: 'Run pnpm inventory to generate docs/dependency-inventory.json' };
  }

  private gitDir(repositoryId: string, space?: string): string {
    const repo = this.catalog.require(repositoryId);
    const located = this.storage.pathsFor(repo.storagePoolId, repo.id);
    return space === 'wiki' ? located.paths.wikiGit : located.paths.gitDir;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, 'JSON object required');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new HttpError(400, 'expected a list of strings');
  return value;
}

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function exportFormat(value: unknown): ExportFormat {
  if (value === 'bundle' || value === 'directory' || value === 'package') return value;
  throw new HttpError(400, 'format must be bundle, directory, or package');
}

function shortRef(ref: { name: string; oid: string }) {
  return { name: ref.name, oid: ref.oid, shortOid: ref.oid.slice(0, 12) };
}

function decodeJobCursor(value: string): { createdAt: string; id: string } | null {
  const [createdAt, id] = value.split('|');
  if (!createdAt || !id) return null;
  return { createdAt, id };
}
