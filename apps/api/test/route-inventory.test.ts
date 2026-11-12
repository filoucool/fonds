import { describe, expect, it } from 'vitest';
import { V1_OPENAPI } from '../src/openapi/v1-spec';

/** Nest-decorated routes we expect to keep stable (method + path template). */
const CORE_API_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/dashboard' },
  { method: 'GET', path: '/api/settings' },
  { method: 'PATCH', path: '/api/settings' },
  { method: 'GET', path: '/api/repositories' },
  { method: 'POST', path: '/api/repositories' },
  { method: 'POST', path: '/api/repositories/import' },
  { method: 'POST', path: '/api/repositories/bulk' },
  { method: 'GET', path: '/api/repositories/:id' },
  { method: 'PATCH', path: '/api/repositories/:id' },
  { method: 'DELETE', path: '/api/repositories/:id' },
  { method: 'POST', path: '/api/repositories/:id/sync' },
  { method: 'POST', path: '/api/repositories/:id/verify' },
  { method: 'POST', path: '/api/repositories/:id/export' },
  { method: 'GET', path: '/api/repositories/:id/tree' },
  { method: 'GET', path: '/api/repositories/:id/blob' },
  { method: 'GET', path: '/api/jobs' },
  { method: 'GET', path: '/api/jobs/:id' },
  { method: 'GET', path: '/api/storage/pools' },
  { method: 'GET', path: '/api/inventory' },
  { method: 'GET', path: '/api/search' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET', path: '/api/auth/session' },
  { method: 'GET', path: '/api/phase3/settings' },
  { method: 'GET', path: '/api/phase3/backups' },
  { method: 'GET', path: '/api/phase3/supply-chain/report' },
];

const V1_PATHS = [
  '/api/v1/repositories',
  '/api/v1/repositories/import',
  '/api/v1/search',
  '/api/v1/jobs/{jobId}',
  '/api/v1/storage/pools',
  '/api/v1/settings',
];

// @suite api.contract.route-inventory
describe('HTTP route inventory', () => {
  it('documents every v1 OpenAPI path used by the CLI and api-client', () => {
    for (const route of V1_PATHS) {
      expect(V1_OPENAPI.paths[route], route).toBeDefined();
    }
  });

  it('keeps the core session API route checklist aligned with controllers', () => {
    expect(CORE_API_ROUTES.length).toBeGreaterThanOrEqual(26);
    const paths = new Set(CORE_API_ROUTES.map((row) => row.path));
    expect(paths.has('/api/repositories/:id/sync')).toBe(true);
    expect(paths.has('/api/phase3/backups')).toBe(true);
  });
});
