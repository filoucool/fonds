import { isRecord } from '@fonds/shared';

export interface FondsClientOptions {
  baseUrl: string;
  token?: string;
}

export interface V1Error {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class FondsClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: FondsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.headers = { accept: 'application/json' };
    if (options.token) this.headers.authorization = `Bearer ${options.token}`;
  }

  async listRepositories(limit = 50, cursor?: string): Promise<unknown> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return this.request(`/api/v1/repositories?${params.toString()}`);
  }

  async importRepository(url: string, idempotencyKey?: string): Promise<unknown> {
    return this.request('/api/v1/repositories/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
      idempotencyKey,
    });
  }

  async getRepository(id: string): Promise<unknown> {
    return this.request(`/api/v1/repositories/${encodeURIComponent(id)}`);
  }

  async syncRepository(id: string): Promise<unknown> {
    return this.request(`/api/v1/repositories/${encodeURIComponent(id)}/sync`, { method: 'POST' });
  }

  async search(q: string, capabilities = 'metadata'): Promise<unknown> {
    const params = new URLSearchParams({ q, capabilities });
    return this.request(`/api/v1/search?${params.toString()}`);
  }

  async getJob(jobId: string): Promise<unknown> {
    return this.request(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async openapi(): Promise<unknown> {
    return this.request('/api/v1/openapi.json');
  }

  private async request(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<unknown> {
    const headers = { ...this.headers, ...(init.headers as Record<string, string> | undefined) };
    if (init.method === 'POST' || init.method === 'PATCH') headers['content-type'] = 'application/json';
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      if (isV1Error(body)) message = body.error.message;
      throw new Error(message);
    }
    return body;
  }
}

function isV1Error(value: unknown): value is V1Error {
  if (!isRecord(value)) return false;
  const err = value.error;
  if (!isRecord(err)) return false;
  return typeof err.message === 'string';
}
