import { describe, expect, it } from 'vitest';
import { addressAllowed, assertRemotePermitted, isBlockedIp } from '../src/policy';
import { computeNextRun, zonedParts } from '../src/schedule';
import { parseRepositoryUrl } from '../src/urls';

const blocked = {
  allowPrivateNetworks: false,
  privateNetworkExceptions: [] as string[],
  allowFileUrls: false,
};

describe('repository URLs', () => {
  it('treats GitHub SSH and HTTPS as the same repository', () => {
    const https = parseRepositoryUrl('https://github.com/Owner/Repo.git');
    const ssh = parseRepositoryUrl('git@github.com:Owner/Repo.git');
    expect(https.identityKey).toBe('github.com/owner/repo');
    expect(ssh.identityKey).toBe(https.identityKey);
    expect(ssh.fetchUrl).toBe('git@github.com:owner/repo.git');
    expect(JSON.stringify(https)).not.toContain('token');
  });

  it('drops embedded credentials and rejects unsafe URLs', () => {
    const parsed = parseRepositoryUrl('https://user:supersecret@github.com/acme/demo');
    expect(parsed.discardedCredentials).toBe(true);
    expect(parsed.canonicalUrl).toBe('https://github.com/acme/demo');
    expect(JSON.stringify(parsed)).not.toContain('supersecret');
    expect(() => parseRepositoryUrl('https://github.com/acme/demo/tree/main')).toThrow();
    expect(() => parseRepositoryUrl('javascript:alert(1)')).toThrow();
    expect(() => parseRepositoryUrl('https://example.com/a\nb')).toThrow();
  });
});

describe('network policy', () => {
  it('blocks loopback, link-local, and metadata addresses', async () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(addressAllowed('10.1.2.3', 'git.internal', { ...blocked, privateNetworkExceptions: ['10.0.0.0/8'] })).toBe(true);
    await expect(assertRemotePermitted('http://127.0.0.1/repo.git', blocked)).rejects.toThrow(/blocked/);
    await expect(assertRemotePermitted('http://169.254.169.254/latest', blocked)).rejects.toThrow(/blocked/);
    await expect(assertRemotePermitted('http://localhost/repo.git', blocked)).rejects.toThrow(/blocked/);
    await expect(assertRemotePermitted('/tmp/repo.git', blocked)).rejects.toThrow(/disabled/);
    await expect(assertRemotePermitted('/tmp/repo.git', { ...blocked, allowFileUrls: true })).resolves.toBeUndefined();
  });
});

describe('schedules', () => {
  it('computes the next daily run in America/New_York', () => {
    const from = new Date('2026-11-07T12:00:00.000Z');
    const next = computeNextRun({ kind: 'daily', hour: 3, minute: 30 }, 'America/New_York', from);
    expect(next?.toISOString()).toBe('2026-11-08T08:30:00.000Z');
    expect(zonedParts(next ?? from, 'America/New_York').hour).toBe(3);
    expect(computeNextRun({ kind: 'manual' }, 'UTC', from)).toBeNull();
  });
});
