import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isRecord, SEARCH_CAPABILITIES, type SearchCapability } from '@fonds/shared';
import { HttpError } from '../errors';
import { AuditService } from '../services/audit';
import { AuthService } from '../services/auth';
import { GitAccessService } from '../services/git-access';
import { CatalogService } from '../services/catalog';
import { SearchService } from '../services/search';
import { SettingsService } from '../services/settings';
import { StorageService } from '../services/storage';
import { WorkerService } from '../services/worker';
import { WorkingRepositoryService } from '../services/working-repos';
import { SESSION_COOKIE, resolveRequestAuth } from './auth-context';
import { touchAuthRateLimit } from './rate-limit';

@Controller('api')
export class Phase2Controller {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(GitAccessService) private readonly gitAccess: GitAccessService,
    @Inject(WorkingRepositoryService) private readonly working: WorkingRepositoryService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(WorkerService) private readonly worker: WorkerService,
  ) {}

  @Post('auth/bootstrap')
  @HttpCode(201)
  bootstrap(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    touchAuthRateLimit(request, 'bootstrap');
    const input = record(body);
    if (typeof input.username !== 'string' || typeof input.password !== 'string') throw new HttpError(400, 'username and password are required');
    const created = this.auth.bootstrap(input.username, input.password);
    setSessionCookie(reply, created.token);
    return { user: created.session.user, csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt };
  }

  @Post('auth/login')
  login(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    touchAuthRateLimit(request, 'login');
    const input = record(body);
    if (typeof input.username !== 'string' || typeof input.password !== 'string') throw new HttpError(400, 'username and password are required');
    const created = this.auth.login(input.username, input.password);
    setSessionCookie(reply, created.token);
    return { user: created.session.user, csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt };
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const ctx = resolveRequestAuth(request, this.auth);
    if (ctx.session) this.auth.logout(ctx.session.sessionId);
    reply.clearCookie(SESSION_COOKIE);
  }

  @Get('auth/session')
  session(@Req() request: FastifyRequest) {
    const ctx = resolveRequestAuth(request, this.auth);
    if (!ctx.session) return { authenticated: false, mode: this.auth.mode() };
    return {
      authenticated: true,
      mode: this.auth.mode(),
      user: ctx.session.user,
      expiresAt: ctx.session.expiresAt,
      csrfToken: ctx.session.csrfToken,
    };
  }

  @Get('search')
  globalSearch(@Query() query: Record<string, string | undefined>) {
    const q = query.q ?? '';
    const capabilities = parseCapabilities(query.capabilities);
    const limit = numberQuery(query.limit) ?? 50;
    const filters = {
      provider: query.provider ?? null,
      categoryId: query.categoryId ?? null,
      tagId: query.tagId ?? null,
      collectionId: query.collectionId ?? null,
      status: query.status ?? null,
    };
    return { items: this.search.search(q, capabilities, limit, filters), usageBytes: this.search.usageBytes() };
  }

  @Get('repositories/:id/search-index')
  searchIndex(@Param('id') id: string) {
    return this.search.status(id);
  }

  @Patch('repositories/:id/search-index')
  patchSearchIndex(@Param('id') id: string, @Body() body: unknown) {
    const input = record(body);
    const raw = isRecord(input.enabled) ? input.enabled : input;
    const patch: { filenames?: boolean; sourceText?: boolean } = {};
    if (typeof raw.filenames === 'boolean') patch.filenames = raw.filenames;
    if (typeof raw.sourceText === 'boolean') patch.sourceText = raw.sourceText;
    const status = this.search.upsertConfig(id, patch);
    if (status.enabled.filenames || status.enabled.sourceText) {
      const jobId = this.catalog.enqueueTyped(id, 'index', {});
      this.worker.wake();
      return { ...status, jobId };
    }
    return status;
  }

  @Delete('repositories/:id/search-index')
  deleteSearchIndex(@Param('id') id: string) {
    this.search.deleteIndex(id);
    return { deleted: true };
  }

  @Post('repositories/:id/search-index/rebuild')
  rebuildSearchIndex(@Param('id') id: string) {
    const jobId = this.catalog.enqueueTyped(id, 'index', { rebuild: true });
    this.worker.wake();
    return { jobId };
  }

  @Post('repositories/:id/search-index/pause')
  pauseSearchIndex(@Param('id') id: string) {
    return this.search.pauseIndex(id);
  }

  @Post('repositories/:id/search-index/resume')
  resumeSearchIndex(@Param('id') id: string) {
    const result = this.search.resumeIndex(id);
    this.worker.wake();
    return result;
  }

  @Get('repositories/:id/clone-urls')
  cloneUrls(@Param('id') id: string) {
    this.catalog.require(id);
    const git = this.settings.get().gitAccess;
    const base = git.publicBaseUrl;
    return this.gitAccess.cloneUrls(id, base, git.sshHost, git.sshPort);
  }

  @Get('working-repositories')
  workingRepositories() {
    return { items: this.working.list() };
  }

  @Post('working-repositories')
  @HttpCode(201)
  async createWorking(@Body() body: unknown) {
    const input = record(body);
    if (typeof input.name !== 'string') throw new HttpError(400, 'name is required');
    const fromArchive = typeof input.fromArchiveRepositoryId === 'string' ? this.catalog.require(input.fromArchiveRepositoryId) : null;
    const gitDir = fromArchive ? this.storage.pathsFor(fromArchive.storagePoolId, fromArchive.id).paths.gitDir : undefined;
    return this.working.create({
      name: input.name,
      archiveRepositoryId: fromArchive?.id ?? null,
      fromArchiveGitDir: gitDir,
    });
  }

  @Get('access-tokens')
  accessTokens(@Req() request: FastifyRequest) {
    const user = requireUser(request, this.auth);
    return { items: this.auth.listAccessTokens(user) };
  }

  @Post('access-tokens')
  @HttpCode(201)
  createAccessToken(@Req() request: FastifyRequest, @Body() body: unknown) {
    const user = requireUser(request, this.auth);
    const input = record(body);
    if (typeof input.label !== 'string') throw new HttpError(400, 'label is required');
    const scopes = parseTokenScopes(input.scopes);
    return this.auth.createAccessToken(user, input.label, scopes, optionalIso(input.expiresAt));
  }

  @Delete('access-tokens/:id')
  revokeAccessToken(@Req() request: FastifyRequest, @Param('id') id: string) {
    const user = requireUser(request, this.auth);
    this.auth.revokeAccessToken(user, id);
    return { revoked: true };
  }

  @Get('ssh-keys')
  sshKeys(@Req() request: FastifyRequest) {
    const user = requireUser(request, this.auth);
    return { items: this.auth.listSshKeys(user) };
  }

  @Post('ssh-keys')
  @HttpCode(201)
  addSshKey(@Req() request: FastifyRequest, @Body() body: unknown) {
    const user = requireUser(request, this.auth);
    const input = record(body);
    if (typeof input.label !== 'string' || typeof input.publicKey !== 'string') throw new HttpError(400, 'label and publicKey are required');
    return this.auth.addSshKey(user, input.label, input.publicKey);
  }

  @Delete('ssh-keys/:id')
  deleteSshKey(@Req() request: FastifyRequest, @Param('id') id: string) {
    const user = requireUser(request, this.auth);
    this.auth.deleteSshKey(user, id);
    return { deleted: true };
  }

  @Get('audit-events')
  listAudit(@Query() query: Record<string, string | undefined>) {
    const limit = numberQuery(query.limit) ?? 50;
    const cursor = decodeAuditCursor(query.cursor);
    return this.audit.list(cursor, limit);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new HttpError(400, 'JSON object required');
  return value;
}

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseCapabilities(raw: string | undefined): SearchCapability[] {
  if (!raw) return ['metadata'];
  const requested = raw.split(',').map((part) => part.trim());
  const allowed: SearchCapability[] = [];
  for (const capability of requested) {
    if (SEARCH_CAPABILITIES.includes(capability as SearchCapability)) allowed.push(capability as SearchCapability);
  }
  return allowed.length > 0 ? allowed : ['metadata'];
}

function parseTokenScopes(raw: unknown): ('api' | 'git_push' | 'git_fetch')[] {
  if (!Array.isArray(raw)) return ['api'];
  const scopes: ('api' | 'git_push' | 'git_fetch')[] = [];
  for (const entry of raw) {
    if (entry === 'api' || entry === 'git_push' || entry === 'git_fetch') scopes.push(entry);
  }
  return scopes.length > 0 ? scopes : ['api'];
}

function optionalIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new HttpError(400, 'expiresAt is invalid');
  return value;
}

function requireUser(request: FastifyRequest, auth: AuthService): string {
  const ctx = resolveRequestAuth(request, auth);
  if (ctx.userId) return ctx.userId;
  throw new HttpError(401, 'authentication required');
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 60 * 60 * 24 * 7,
  });
}

function decodeAuditCursor(value: string | undefined): { createdAt: string; id: string } | null {
  if (!value) return null;
  const [createdAt, idPart] = value.split('|');
  if (!createdAt || !idPart) return null;
  return { createdAt, id: idPart };
}
