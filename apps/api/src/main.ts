import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isRecord, UrlRejectedError } from '@repo-archive/shared';
import { loadConfig } from './config';
import { createContainer } from './container';
import { HttpError, StorageThresholdError } from './errors';
import { AppModule } from './http/app.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const container = createContainer(config);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(container), new FastifyAdapter({ logger: false, bodyLimit: 5 * 1024 * 1024 }), { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  if (config.workerEnabled) container.worker.start();
  const shutdown = async () => {
    await container.worker.stop();
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
  console.log(`Archiver listening on http://${config.host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    console.log('The process is bound to all interfaces. Publish it only on a trusted network.');
  }
}

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent) return;
    if (exception instanceof HttpError) {
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
