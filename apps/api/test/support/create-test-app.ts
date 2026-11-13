import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import { isRecord, UrlRejectedError } from '@fonds/shared';
import { loadConfig, type AppConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { HttpError, StorageThresholdError } from '../../src/errors';
import { AppModule } from '../../src/http/app.module';
import { resolveRequestAuth } from '../../src/http/auth-context';
import { registerGitHttpRoutes } from '../../src/http/git-http';
import { v1ErrorFromHttp } from '../../src/http/v1-envelope';

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<{ url?: string }>();
    const route = request.url?.split('?')[0] ?? '';
    const v1 = route.startsWith('/api/v1');
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
      const message =
        typeof response === 'string'
          ? response
          : isRecord(response) && typeof response.message === 'string'
            ? response.message
            : exception.message;
      reply.status(exception.getStatus()).send({ error: Array.isArray(message) ? message.join('; ') : message });
      return;
    }
    reply.status(500).send({ error: 'Internal error' });
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  container: Container;
  config: AppConfig;
  close: () => Promise<void>;
}

export async function createTestApp(dataDir?: string): Promise<TestApp> {
  const root = dataDir ?? mkdtempSync(path.join(tmpdir(), 'fonds-http-'));
  const config = loadConfig({
    DATA_DIR: root,
    HOST: '127.0.0.1',
    PORT: '8080',
    WORKER_ENABLED: 'true',
    PATH: process.env.PATH,
  });
  const container = createContainer(config);
  const nest = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(container),
    new FastifyAdapter({ logger: false, bodyLimit: 64 * 1024 * 1024 }),
    { logger: false },
  );
  const fastify = nest.getHttpAdapter().getInstance();
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
      return reply.status(401).send({ error: 'authentication required' });
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
      return reply.status(403).send({ error: 'csrf token invalid' });
    }
  });
  nest.useGlobalFilters(new ApiExceptionFilter());
  await nest.init();
  await nest.getHttpAdapter().getInstance().ready();

  const close = async () => {
    await container.worker.stop();
    await nest.close();
    container.sqlite.close();
  };

  return { app: nest, container, config, close };
}

export async function injectJson(
  app: NestFastifyApplication,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await app.inject({
    method,
    url,
    payload: payload === undefined ? undefined : JSON.stringify(payload),
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
  });
  let body: unknown = response.body;
  try {
    body = JSON.parse(response.body);
  } catch {
    // keep text
  }
  return { statusCode: response.statusCode, body };
}
