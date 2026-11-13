// @suite api.contract.v1-openapi
// @suite api.contract.v1-envelope
import { describe, expect, it } from 'vitest';
import { V1_OPENAPI } from '../src/openapi/v1-spec';
import { v1ErrorFromHttp } from '../src/http/v1-envelope';
import { HttpError } from '../src/errors';

describe('v1 api contract', () => {
  it('publishes openapi paths for core resources', () => {
    expect(V1_OPENAPI.paths['/api/v1/repositories']).toBeDefined();
    expect(V1_OPENAPI.paths['/api/v1/search']).toBeDefined();
    expect(V1_OPENAPI.paths['/api/v1/jobs/{jobId}']).toBeDefined();
  });

  it('maps http errors to stable envelope codes', () => {
    expect(v1ErrorFromHttp(new HttpError(404, 'missing')).error.code).toBe('not_found');
    expect(v1ErrorFromHttp(new HttpError(401, 'nope')).error.code).toBe('unauthorized');
    expect(v1ErrorFromHttp(new HttpError(400, 'bad', { field: 'url' })).error.details).toEqual({ field: 'url' });
  });
});
