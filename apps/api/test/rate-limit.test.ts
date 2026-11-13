import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clearIpRateLimitsForTests, touchIpRateLimit } from '../src/http/rate-limit';
import { assertV1Idempotency, clearV1GuardsForTests, storeV1Idempotency } from '../src/http/v1-guards';

function fakeRequest(ip: string): FastifyRequest {
  return { ip } as FastifyRequest;
}

describe('rate-limit shared store', () => {
  afterEach(() => {
    clearV1GuardsForTests();
    vi.useRealTimers();
  });

  it('drops expired IP buckets on the next touch', () => {
    vi.useFakeTimers();
    const config = { limit: 2, windowMs: 1000 };
    touchIpRateLimit(fakeRequest('10.0.0.1'), 'probe', config);
    touchIpRateLimit(fakeRequest('10.0.0.1'), 'probe', config);
    vi.advanceTimersByTime(1001);
    touchIpRateLimit(fakeRequest('10.0.0.1'), 'probe', config);
    touchIpRateLimit(fakeRequest('10.0.0.1'), 'probe', config);
    expect(() => touchIpRateLimit(fakeRequest('10.0.0.1'), 'probe', config)).toThrow();
  });

  it('evicts expired idempotency entries on access', () => {
    vi.useFakeTimers();
    const req = {
      headers: { 'idempotency-key': 'abc' },
    } as FastifyRequest;
    storeV1Idempotency(req, { route: 'import' }, { ok: true });
    expect(assertV1Idempotency(req, { route: 'import' })).toEqual({ ok: true });
    vi.advanceTimersByTime(16 * 60_000);
    expect(assertV1Idempotency(req, { route: 'import' })).toBeNull();
  });
});
