import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { gitReceivePack, gitUploadPack, serviceAdvertisement } from '@repo-archive/git-exec';
import type { AuthService } from '../services/auth';
import type { GitAccessService } from '../services/git-access';
import type { SettingsService } from '../services/settings';
import { HttpError } from '../errors';
import { readBearer, resolveRequestAuth } from './auth-context';

export function registerGitHttpRoutes(
  app: FastifyInstance,
  gitAccess: GitAccessService,
  auth: AuthService,
  settings: SettingsService,
): void {
  app.addContentTypeParser('application/x-git-upload-pack-request', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  app.addContentTypeParser('application/x-git-receive-pack-request', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  app.get('/git/archive/:id/info/refs', async (request, reply) => handleInfoRefs(request, reply, 'archive', gitAccess, auth, settings));
  app.get('/git/working/:name/info/refs', async (request, reply) => handleInfoRefs(request, reply, 'working', gitAccess, auth, settings));
  app.post('/git/archive/:id/git-upload-pack', async (request, reply) => handleUploadPack(request, reply, 'archive', gitAccess, auth, settings));
  app.post('/git/working/:name/git-upload-pack', async (request, reply) => handleUploadPack(request, reply, 'working', gitAccess, auth, settings));
  app.post('/git/archive/:id/git-receive-pack', async (_request, reply) => {
    reply.status(403).send('receive-pack refused: archives are read-only\n');
  });
  app.post('/git/working/:name/git-receive-pack', async (request, reply) => handleReceivePack(request, reply, gitAccess, auth, settings));
}

async function handleInfoRefs(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: 'archive' | 'working',
  gitAccess: GitAccessService,
  auth: AuthService,
  settings: SettingsService,
): Promise<void> {
  ensureGitHttpEnabled(settings);
  const query = request.query as { service?: string };
  const service = query.service;
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') throw new HttpError(400, 'service is required');
  const target = resolveTarget(kind, request.params as { id?: string; name?: string }, gitAccess);
  if (service === 'git-receive-pack' && target.readOnly) throw new HttpError(403, 'receive-pack refused');
  assertGitAuth(request, auth, service === 'git-receive-pack' ? 'git_push' : 'git_fetch');
  const body = service === 'git-upload-pack' ? await gitUploadPack({ gitDir: target.gitDir, advertise: true, timeoutMs: 120_000 }) : await gitReceivePack({ gitDir: target.gitDir, advertise: true, timeoutMs: 120_000 });
  reply.header('content-type', `application/x-${service}-advertisement`);
  reply.header('cache-control', 'no-cache');
  reply.send(serviceAdvertisement(service, body));
}

async function handleUploadPack(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: 'archive' | 'working',
  gitAccess: GitAccessService,
  auth: AuthService,
  settings: SettingsService,
): Promise<void> {
  ensureGitHttpEnabled(settings);
  const target = resolveTarget(kind, request.params as { id?: string; name?: string }, gitAccess);
  assertGitAuth(request, auth, 'git_fetch');
  const input = request.body as Buffer;
  const body = await gitUploadPack({ gitDir: target.gitDir, input, timeoutMs: 3_600_000 });
  reply.header('content-type', 'application/x-git-upload-pack-result');
  reply.send(body);
}

async function handleReceivePack(
  request: FastifyRequest,
  reply: FastifyReply,
  gitAccess: GitAccessService,
  auth: AuthService,
  settings: SettingsService,
): Promise<void> {
  ensureGitHttpEnabled(settings);
  const target = resolveTarget('working', request.params as { name?: string }, gitAccess);
  assertGitAuth(request, auth, 'git_push');
  const body = await gitReceivePack({ gitDir: target.gitDir, input: request.body as Buffer, timeoutMs: 3_600_000 });
  reply.header('content-type', 'application/x-git-receive-pack-result');
  reply.send(body);
}

function resolveTarget(kind: 'archive' | 'working', params: { id?: string; name?: string }, gitAccess: GitAccessService) {
  if (kind === 'archive') {
    const id = params.id?.replace(/\.git$/, '') ?? '';
    return gitAccess.resolveArchive(id);
  }
  const name = params.name?.replace(/\.git$/, '') ?? '';
  return gitAccess.resolveWorking(name);
}

function ensureGitHttpEnabled(settings: SettingsService): void {
  if (!settings.get().gitAccess.httpEnabled) throw new HttpError(503, 'git http access is disabled');
}

function assertGitAuth(request: FastifyRequest, auth: AuthService, scope: 'git_fetch' | 'git_push'): void {
  if (!auth.requiresAuth()) return;
  const ctx = resolveRequestAuth(request, auth);
  if (ctx.kind === 'session') return;
  if (ctx.kind === 'token' && ctx.tokenScopes.includes(scope)) return;
  const token = readBearer(request);
  if (token && auth.resolveAccessToken(token)?.scopes.includes(scope)) return;
  throw new HttpError(401, 'git authentication required');
}
