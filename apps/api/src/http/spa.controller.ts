import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config';
import { APP_CONFIG } from './tokens';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

@Controller()
export class SpaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('*')
  index(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const webDist = this.config.webDist;
    const raw = (request.url ?? '/').split('?')[0] ?? '/';
    if (raw.startsWith('/api') || !webDist) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    const relative = raw === '/' ? 'index.html' : decodeURIComponent(raw.replace(/^\/+/, ''));
    const root = path.resolve(webDist);
    const file = path.resolve(root, relative);
    if (file.startsWith(`${root}${path.sep}`) && existsSync(file) && statSync(file).isFile()) {
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      reply.type(type).send(createReadStream(file));
      return;
    }
    reply.type('text/html; charset=utf-8').send(readFileSync(path.join(root, 'index.html')));
  }
}
