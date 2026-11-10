import type { FastifyRequest } from 'fastify';
import { HttpError } from '../errors';

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const idempotency = new Map<string, { expiresAt: number; body: unknown }>();

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const IDEMPOTENCY_TTL_MS = 15 * 60_000;

export function touchV1RateLimit(request: FastifyRequest, scope: string): void {
  const ip = request.ip ?? 'local';
  const key = `${ip}:${scope}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT) {
    throw new HttpError(429, 'rate limit exceeded', { retryAfterMs: current.resetAt - now });
  }
}

export function assertV1Idempotency(request: FastifyRequest, fingerprint: Record<string, string>): unknown | null {
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || key.trim().length === 0) return null;
  const id = `${key.trim()}:${JSON.stringify(fingerprint)}`;
  const now = Date.now();
  const hit = idempotency.get(id);
  if (hit && hit.expiresAt > now) return hit.body;
  return null;
}

export function storeV1Idempotency(request: FastifyRequest, fingerprint: Record<string, string>, body: unknown): void {
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || key.trim().length === 0) return;
  const id = `${key.trim()}:${JSON.stringify(fingerprint)}`;
  idempotency.set(id, { expiresAt: Date.now() + IDEMPOTENCY_TTL_MS, body });
}
