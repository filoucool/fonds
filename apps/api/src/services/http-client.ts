import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { lookup, type LookupAddress, type LookupOptions } from 'node:dns';
import path from 'node:path';
import { addressAllowed, assertRemotePermitted, type NetworkPolicy } from '@fonds/shared/policy';
import { RateLimitError } from '../errors';

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  body: unknown;
}

export interface DownloadResult {
  sha256: string;
  bytes: number;
}

export interface ArchiveHttp {
  request(input: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    policy: NetworkPolicy;
  }): Promise<HttpResult>;
  download(input: {
    url: string;
    destination: string;
    headers?: Record<string, string>;
    maxBytes: number | null;
    signal?: AbortSignal;
    timeoutMs?: number;
    policy: NetworkPolicy;
    onProgress?: (bytes: number) => void;
  }): Promise<DownloadResult>;
}

export class NodeHttpClient implements ArchiveHttp {
  async request(input: {
    url: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    policy: NetworkPolicy;
  }): Promise<HttpResult> {
    return this.exchange(input.url, input, 0);
  }

  async download(input: {
    url: string;
    destination: string;
    headers?: Record<string, string>;
    maxBytes: number | null;
    signal?: AbortSignal;
    timeoutMs?: number;
    policy: NetworkPolicy;
    onProgress?: (bytes: number) => void;
  }): Promise<DownloadResult> {
    const temporary = `${input.destination}.${process.pid}.partial`;
    await mkdir(path.dirname(input.destination), { recursive: true });
    try {
      const result = await this.stream(input.url, input, temporary, 0);
      await rename(temporary, input.destination);
      return result;
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async exchange(
    url: string,
    input: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      policy: NetworkPolicy;
    },
    redirects: number,
  ): Promise<HttpResult> {
    await assertRemotePermitted(url, input.policy);
    const response = await this.raw(url, input);
    if (isRedirect(response.status) && redirects < 5) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect missing location');
      const next = new URL(location, url);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('redirect protocol is not allowed');
      const headers = { ...(input.headers ?? {}) };
      if (new URL(url).host !== next.host) delete headers.authorization;
      delete headers.Authorization;
      return this.exchange(next.toString(), { ...input, headers, method: response.status === 303 ? 'GET' : input.method, body: response.status === 303 ? undefined : input.body }, redirects + 1);
    }
    const text = response.text;
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '30');
      const seconds = Number.isFinite(retryAfter) ? retryAfter : 30;
      throw new RateLimitError('provider rate limit', new Date(Date.now() + seconds * 1000).toISOString());
    }
    return { status: response.status, headers: response.headers, text, body };
  }

  private async stream(
    url: string,
    input: {
      headers?: Record<string, string>;
      maxBytes: number | null;
      signal?: AbortSignal;
      timeoutMs?: number;
      policy: NetworkPolicy;
      onProgress?: (bytes: number) => void;
    },
    destination: string,
    redirects: number,
  ): Promise<DownloadResult> {
    await assertRemotePermitted(url, input.policy);
    const response = await this.openStream(url, input);
    if (isRedirect(response.status) && redirects < 5) {
      response.stream.destroy();
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect missing location');
      const next = new URL(location, url);
      const headers = { ...(input.headers ?? {}) };
      if (new URL(url).host !== next.host) {
        delete headers.authorization;
        delete headers.Authorization;
      }
      return this.stream(next.toString(), { ...input, headers }, destination, redirects + 1);
    }
    if (response.status >= 400) {
      response.stream.destroy();
      throw new Error(`download failed with status ${response.status}`);
    }
    const hash = createHash('sha256');
    const handle = await open(destination, 'w', 0o644);
    let bytes = 0;
    try {
      for await (const chunk of response.stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (input.maxBytes !== null && bytes > input.maxBytes) {
          throw new Error('download exceeded the size limit');
        }
        input.onProgress?.(bytes);
        hash.update(buffer);
        await handle.write(buffer);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { sha256: hash.digest('hex'), bytes };
  }

  private raw(
    url: string,
    input: {
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      policy: NetworkPolicy;
    },
  ): Promise<{ status: number; headers: Headers; text: string }> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = lib(
        target,
        {
          method: input.method ?? 'GET',
          headers: { 'user-agent': 'fonds/0.1', accept: 'application/json', ...(input.headers ?? {}) },
          lookup: blockedLookup(input.policy),
          timeout: input.timeoutMs ?? 60_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.byteLength;
            if (size > 20 * 1024 * 1024) {
              req.destroy(new Error('response exceeded 20MB'));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === 'string') headers.set(key, value);
              else if (Array.isArray(value)) headers.set(key, value.join(', '));
            }
            resolve({ status: res.statusCode ?? 0, headers, text: Buffer.concat(chunks).toString('utf8') });
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      if (input.signal) {
        if (input.signal.aborted) req.destroy(new Error('cancelled'));
        else input.signal.addEventListener('abort', () => req.destroy(new Error('cancelled')), { once: true });
      }
      if (input.body) req.write(input.body);
      req.end();
    });
  }

  private openStream(
    url: string,
    input: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number; policy: NetworkPolicy },
  ): Promise<{ status: number; headers: Headers; stream: IncomingMessage }> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = lib(
        target,
        {
          method: 'GET',
          headers: { 'user-agent': 'fonds/0.1', ...(input.headers ?? {}) },
          lookup: blockedLookup(input.policy),
          timeout: input.timeoutMs ?? 60_000,
        },
        (res) => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(', '));
          }
          resolve({ status: res.statusCode ?? 0, headers, stream: res });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timed out')));
      if (input.signal) {
        if (input.signal.aborted) req.destroy(new Error('cancelled'));
        else input.signal.addEventListener('abort', () => req.destroy(new Error('cancelled')), { once: true });
      }
      req.end();
    });
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function blockedLookup(policy: NetworkPolicy) {
  return (hostname: string, options: LookupOptions | LookupCallback, maybeCallback?: LookupCallback) => {
    const lookupOptions = typeof options === 'function' ? {} : options;
    const callback = typeof options === 'function' ? options : maybeCallback;
    if (!callback) return;
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        if (lookupOptions.all) callback(error, []);
        else callback(error, '', 4);
        return;
      }
      const allowed = addresses.filter((entry) => addressAllowed(entry.address, hostname, policy));
      if (allowed.length === 0) {
        const blocked = blockedAddressError(hostname);
        if (lookupOptions.all) callback(blocked, []);
        else callback(blocked, '', 4);
        return;
      }
      if (lookupOptions.all) {
        callback(
          null,
          allowed.map((entry) => ({ address: entry.address, family: entry.family })),
        );
        return;
      }
      const first = allowed[0];
      if (!first) return;
      callback(null, first.address, first.family);
    });
  };
}

function blockedAddressError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`blocked address for ${hostname}`), { code: 'EPERM' });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>;\s*rel="?next"?/i.exec(part);
    if (match?.[1]) return match[1];
  }
  return null;
}
