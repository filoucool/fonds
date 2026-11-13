import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearIpRateLimitsForTests, DEFAULT_RATE_LIMIT_CONFIG } from '../src/http/rate-limit';
import { createTestApp, injectJson, type TestApp } from './support/create-test-app';

describe('auth login rate limiting', () => {
  let harness: TestApp | undefined;

  beforeEach(() => {
    clearIpRateLimitsForTests();
  });

  afterEach(async () => {
    if (!harness) return;
    const dataDir = harness.config.dataDir;
    await harness.close();
    rmSync(dataDir, { recursive: true, force: true });
    harness = undefined;
  });

  it('returns 429 after exceeding per-IP login attempts', async () => {
    harness = await createTestApp();
    await injectJson(harness.app, 'POST', '/api/auth/bootstrap', {
      username: 'admin',
      password: 'twelve-char-password',
    });

    const limit = DEFAULT_RATE_LIMIT_CONFIG.limit;
    const payload = { username: 'admin', password: 'wrong-password-1' };
    for (let i = 0; i < limit; i += 1) {
      const attempt = await injectJson(harness.app, 'POST', '/api/auth/login', payload);
      expect(attempt.statusCode).not.toBe(429);
    }

    const blocked = await injectJson(harness.app, 'POST', '/api/auth/login', payload);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual(expect.objectContaining({ error: 'rate limit exceeded' }));
  });

  it('limits bootstrap attempts separately from login', async () => {
    harness = await createTestApp();
    const limit = DEFAULT_RATE_LIMIT_CONFIG.limit;
    for (let i = 0; i < limit; i += 1) {
      const attempt = await injectJson(harness.app, 'POST', '/api/auth/bootstrap', {
        username: `user-${i}`,
        password: 'twelve-char-password',
      });
      expect(attempt.statusCode).not.toBe(429);
    }
    const blocked = await injectJson(harness.app, 'POST', '/api/auth/bootstrap', {
      username: 'another',
      password: 'twelve-char-password',
    });
    expect(blocked.statusCode).toBe(429);
  });
});
