import type { FastifyRequest } from 'fastify';
import { HttpError } from '../errors';

export type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  limit: 60,
  windowMs: 60_000,
};

function evictExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function touchIpRateLimit(
  request: FastifyRequest,
  scope: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG,
): void {
  const now = Date.now();
  evictExpiredBuckets(now);
  const ip = request.ip ?? 'local';
  const key = `${ip}:${scope}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return;
  }
  current.count += 1;
  if (current.count > config.limit) {
    throw new HttpError(429, 'rate limit exceeded', { retryAfterMs: current.resetAt - now });
  }
}

export function touchAuthRateLimit(request: FastifyRequest, action: 'login' | 'bootstrap'): void {
  touchIpRateLimit(request, `auth:${action}`, DEFAULT_RATE_LIMIT_CONFIG);
}

export function clearIpRateLimitsForTests(): void {
  buckets.clear();
}
