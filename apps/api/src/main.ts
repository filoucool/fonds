import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isRecord, UrlRejectedError } from '@fonds/shared';
import { loadConfig } from './config';
import { createContainer } from './container';
import { HttpError, StorageThresholdError } from './errors';
import { AppModule } from './http/app.module';
import { registerGitHttpRoutes } from './http/git-http';
import { resolveRequestAuth } from './http/auth-context';
import { v1ErrorFromHttp } from './http/v1-envelope';
import cookie from '@fastify/cookie';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(container), new FastifyAdapter({ logger: false, bodyLimit: 64 * 1024 * 1024 }), { logger: false });
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(cookie);
  registerGitHttpRoutes(fastify, container.gitAccess, container.auth, container.settings);
  fastify.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? request.url;
    if (url.startsWith('/git/') || url === '/api/health' || url.startsWith('/api/v1/openapi.json')) return;
    if (url.startsWith('/api/auth/bootstrap') || url.startsWith('/api/auth/login')) return;
    if (!container.auth.requiresAuth()) return;
    const publicPaths = ['/api/auth/session'];
    if (publicPaths.includes(url)) return;
    const ctx = resolveRequestAuth(request, container.auth);
    const apiAllowed = ctx.kind === 'session' || (ctx.kind === 'token' && ctx.tokenScopes.includes('api'));
    if (!apiAllowed) {
      reply.status(401).send({ error: 'authentication required' });
    }
  });
  fastify.addHook('preHandler', async (request, reply) => {
    const method = request.method?.toUpperCase() ?? 'GET';
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const url = request.url.split('?')[0] ?? request.url;
    if (url.startsWith('/git/')) return;
    if (!container.auth.requiresAuth()) return;
    const ctx = resolveRequestAuth(request, container.auth);
    if (ctx.kind !== 'session' || !ctx.session) return;
    const csrfHeader = request.headers['x-csrf-token'];
    const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (typeof csrf !== 'string' || csrf !== ctx.session.csrfToken) {
      reply.status(403).send({ error: 'csrf token invalid' });
    }
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  if (config.workerEnabled) {
    container.worker.start();
    if (container.settings.get().gitAccess.sshEnabled) {
      try {
        container.gitSsh.start();
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Git SSH failed to start');
      }
    }
  }
  const shutdown = async () => {
    await container.worker.stop();
    await container.gitSsh.stop();
    await app.close();
    container.sqlite.close();
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  await app.listen(config.port, config.host);
  console.log(`Fonds listening on http://${config.host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    console.log('The process is bound to all interfaces. Publish it only on a trusted network.');
  }
}

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<{ url?: string }>();
    const path = request.url?.split('?')[0] ?? '';
    const v1 = path.startsWith('/api/v1');
    if (reply.sent) return;
    if (exception instanceof HttpError) {
      if (v1) {
        reply.status(exception.status).send(v1ErrorFromHttp(exception));
        return;
      }
      reply.status(exception.status).send({ error: exception.message, ...exception.details });
      return;
    }
    if (exception instanceof StorageThresholdError) {
      reply.status(507).send({ error: exception.message, category: 'storage' });
      return;
    }
    if (exception instanceof UrlRejectedError) {
      reply.status(400).send({ error: exception.message, category: 'validation' });
      return;
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : isRecord(response) && typeof response.message === 'string' ? response.message : exception.message;
      reply.status(exception.getStatus()).send({ error: Array.isArray(message) ? message.join('; ') : message });
      return;
    }
    console.error(exception);
    reply.status(500).send({ error: 'Internal error' });
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
