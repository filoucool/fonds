import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { UrlRejectedError, assertFetchUrlShape } from './urls';

export interface NetworkPolicy {
  allowPrivateNetworks: boolean;
  privateNetworkExceptions: string[];
  allowFileUrls: boolean;
}

const block = new BlockList();
block.addSubnet('0.0.0.0', 8, 'ipv4');
block.addSubnet('10.0.0.0', 8, 'ipv4');
block.addSubnet('100.64.0.0', 10, 'ipv4');
block.addSubnet('127.0.0.0', 8, 'ipv4');
block.addSubnet('169.254.0.0', 16, 'ipv4');
block.addSubnet('172.16.0.0', 12, 'ipv4');
block.addSubnet('192.0.0.0', 24, 'ipv4');
block.addSubnet('192.0.2.0', 24, 'ipv4');
block.addSubnet('192.168.0.0', 16, 'ipv4');
block.addSubnet('198.18.0.0', 15, 'ipv4');
block.addSubnet('198.51.100.0', 24, 'ipv4');
block.addSubnet('203.0.113.0', 24, 'ipv4');
block.addSubnet('224.0.0.0', 4, 'ipv4');
block.addSubnet('240.0.0.0', 4, 'ipv4');
block.addAddress('255.255.255.255', 'ipv4');
block.addAddress('::', 'ipv6');
block.addAddress('::1', 'ipv6');
block.addSubnet('fc00::', 7, 'ipv6');
block.addSubnet('fe80::', 10, 'ipv6');
block.addSubnet('ff00::', 8, 'ipv6');
block.addSubnet('2001:db8::', 32, 'ipv6');

const BLOCKED_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.internal',
]);

export function isBlockedIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return true;
  return block.check(normalized.ip, normalized.family);
}

export async function assertRemotePermitted(
  fetchUrl: string,
  policy: NetworkPolicy,
  resolveHost: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<void> {
  assertFetchUrlShape(fetchUrl, policy.allowFileUrls);
  if (fetchUrl.startsWith('/') || fetchUrl.startsWith('file:')) return;
  const hostname = hostnameOf(fetchUrl);
  if (!hostname) throw new UrlRejectedError('repository host is missing');
  if (isBlockedName(hostname) && !isExcepted(hostname, policy)) {
    throw new UrlRejectedError(`host ${hostname} is blocked`);
  }
  const literal = normalizeIp(hostname);
  const addresses = literal ? [literal.ip] : await resolveHost(hostname);
  if (addresses.length === 0) throw new UrlRejectedError(`host ${hostname} did not resolve`);
  for (const address of addresses) {
    if (!addressAllowed(address, hostname, policy)) {
      throw new UrlRejectedError(`destination ${hostname} resolved to a blocked address`);
    }
  }
}

export function addressAllowed(ip: string, hostname: string, policy: NetworkPolicy): boolean {
  if (!isBlockedIp(ip)) return true;
  if (policy.allowPrivateNetworks) return true;
  if (isExcepted(hostname, policy) || isExcepted(ip, policy)) return true;
  return policy.privateNetworkExceptions.some((entry) => entry.includes('/') && ipv4InCidr(ip, entry));
}

export async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

function hostnameOf(fetchUrl: string): string | null {
  if (fetchUrl.includes('://')) {
    try {
      return new URL(fetchUrl).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return null;
    }
  }
  const scp = /^[\w.+-]+@([\w.-]+):/.exec(fetchUrl);
  return scp?.[1] ?? null;
}

function isBlockedName(hostname: string): boolean {
  return BLOCKED_NAMES.has(hostname.toLowerCase());
}

function isExcepted(value: string, policy: NetworkPolicy): boolean {
  const needle = value.toLowerCase();
  return policy.privateNetworkExceptions.some((entry) => entry.toLowerCase() === needle);
}

function normalizeIp(ip: string): { ip: string; family: 'ipv4' | 'ipv6' } | null {
  const mapped = ip.toLowerCase().startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (isIP(mapped) === 4) return { ip: mapped, family: 'ipv4' };
  if (isIP(ip) === 6) return { ip, family: 'ipv6' };
  return null;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split('/');
  if (!base || bitsText === undefined) return false;
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}
