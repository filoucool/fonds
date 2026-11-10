import type { FastifyReply } from 'fastify';
import { HttpError } from '../errors';

export interface V1ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function sendV1Error(reply: FastifyReply, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  const body: V1ErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
  reply.status(status).send(body);
}

export function v1ErrorFromHttp(error: HttpError): V1ErrorBody {
  const code = error.status === 404 ? 'not_found' : error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' : 'invalid_request';
  return { error: { code, message: error.message, ...(Object.keys(error.details).length > 0 ? { details: error.details } : {}) } };
}
