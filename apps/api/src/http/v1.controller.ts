import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isRecord, SEARCH_CAPABILITIES, type ExportFormat, type SearchCapability } from '@repo-archive/shared';
import { HttpError } from '../errors';
import { V1_OPENAPI } from '../openapi/v1-spec';
import { assertV1Idempotency, storeV1Idempotency, touchV1RateLimit } from './v1-guards';
import { CatalogService } from '../services/catalog';
import { ExportService } from '../services/exporter';
import { JobsService } from '../services/jobs';
import { SearchService } from '../services/search';
import { SettingsService } from '../services/settings';
import { StorageService } from '../services/storage';
import { WorkerService } from '../services/worker';

@Controller('api/v1')
export class V1Controller {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(ExportService) private readonly exporter: ExportService,
    @Inject(WorkerService) private readonly worker: WorkerService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  @Get('openapi.json')
  openapi() {
    return V1_OPENAPI;
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
      sort: query.sort === 'name' || query.sort === 'size' ? query.sort : 'updated',
      includeDeleted: query.includeDeleted === 'true',
    });
  }

  @Post('repositories/import')
  @HttpCode(202)
  async importRepositories(@Req() request: FastifyRequest, @Body() body: unknown) {
    touchV1RateLimit(request, 'import');
    const input = record(body);
    if (typeof input.url !== 'string') throw new HttpError(400, 'url is required');
    const cached = assertV1Idempotency(request, { url: input.url });
    if (cached) return cached;
    const result = await this.catalog.create({
      url: input.url,
      displayName: optionalString(input.displayName),
      profileId: optionalString(input.profileId),
      syncProfileId: optionalString(input.syncProfileId),
      categoryId: optionalString(input.categoryId),
      tagIds: [],
    });
    this.worker.wake();
    storeV1Idempotency(request, { url: input.url }, result);
    return result;
  }

  @Get('repositories/:id')
  getRepository(@Param('id') id: string) {
    return this.catalog.get(id);
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

  @Get('search')
  searchCatalog(@Query() query: Record<string, string | undefined>) {
    const filters = {
      provider: query.provider ?? null,
      categoryId: query.categoryId ?? null,
      tagId: query.tagId ?? null,
      collectionId: query.collectionId ?? null,
      status: query.status ?? null,
    };
    return {
      items: this.search.search(query.q ?? '', parseCapabilities(query.capabilities), numberQuery(query.limit) ?? 50, filters),
      usageBytes: this.search.usageBytes(),
    };
  }

  @Get('jobs/:jobId')
  job(@Param('jobId') id: string) {
    return this.jobs.get(id);
  }

  @Post('jobs/:jobId/cancel')
  cancel(@Param('jobId') id: string) {
    this.jobs.cancel(id);
    return this.jobs.get(id);
  }

  @Get('storage/pools')
  pools() {
    return { items: this.storage.list() };
  }

  @Get('settings')
  getSettings() {
    return { settings: this.settings.get() };
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, 'JSON object required');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
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

function isSearchCapability(value: string): value is SearchCapability {
  return SEARCH_CAPABILITIES.some((item) => item === value);
}

function parseCapabilities(raw: string | undefined): SearchCapability[] {
  if (!raw || raw.trim().length === 0) return [...SEARCH_CAPABILITIES];
  const picked: SearchCapability[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (isSearchCapability(trimmed)) picked.push(trimmed);
  }
  return picked.length > 0 ? picked : ['metadata'];
}
