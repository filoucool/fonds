import type { FastifyRequest } from 'fastify';
import { clearIpRateLimitsForTests, DEFAULT_RATE_LIMIT_CONFIG, touchIpRateLimit } from './rate-limit';

const idempotency = new Map<string, { expiresAt: number; body: unknown }>();

const IDEMPOTENCY_TTL_MS = 15 * 60_000;

function evictExpiredIdempotency(now: number): void {
  for (const [key, entry] of idempotency) {
    if (entry.expiresAt <= now) {
      idempotency.delete(key);
    }
  }
}

export function touchV1RateLimit(request: FastifyRequest, scope: string): void {
  touchIpRateLimit(request, scope, DEFAULT_RATE_LIMIT_CONFIG);
}

export function assertV1Idempotency(request: FastifyRequest, fingerprint: Record<string, string>): unknown | null {
  const now = Date.now();
  evictExpiredIdempotency(now);
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || key.trim().length === 0) return null;
  const id = `${key.trim()}:${JSON.stringify(fingerprint)}`;
  const hit = idempotency.get(id);
  if (hit && hit.expiresAt > now) return hit.body;
  if (hit) idempotency.delete(id);
  return null;
}

export function storeV1Idempotency(request: FastifyRequest, fingerprint: Record<string, string>, body: unknown): void {
  const now = Date.now();
  evictExpiredIdempotency(now);
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || key.trim().length === 0) return;
  const id = `${key.trim()}:${JSON.stringify(fingerprint)}`;
  idempotency.set(id, { expiresAt: now + IDEMPOTENCY_TTL_MS, body });
}

export function clearV1GuardsForTests(): void {
  clearIpRateLimitsForTests();
  idempotency.clear();
}
