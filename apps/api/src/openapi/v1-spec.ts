export const V1_OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Fonds API',
    version: '1.0.0',
    description: 'Versioned REST API for catalog, jobs, search, and storage.',
  },
  servers: [{ url: '/' }],
  components: {
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      JobRef: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
      },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'fonds_session' },
    },
  },
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  paths: {
    '/api/v1/repositories': {
      get: {
        operationId: 'listRepositories',
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'provider', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Cursor page of repositories' } },
      },
    },
    '/api/v1/repositories/import': {
      post: {
        operationId: 'importRepository',
        responses: { '202': { description: 'Import accepted', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobRef' } } } } },
      },
    },
    '/api/v1/repositories/{id}': {
      get: { operationId: 'getRepository', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Repository detail' } } },
    },
    '/api/v1/repositories/{id}/sync': {
      post: {
        operationId: 'syncRepository',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Sync job', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobRef' } } } } },
      },
    },
    '/api/v1/repositories/{id}/verify': {
      post: { operationId: 'verifyRepository', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Verify job' } } },
    },
    '/api/v1/repositories/{id}/export': {
      post: { operationId: 'exportRepository', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Export job' } } },
    },
    '/api/v1/search': {
      get: {
        operationId: 'search',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'capabilities', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'provider', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Search hits' } },
      },
    },
    '/api/v1/jobs/{jobId}': {
      get: {
        operationId: 'getJob',
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Job detail' } },
      },
    },
    '/api/v1/jobs/{jobId}/cancel': {
      post: {
        operationId: 'cancelJob',
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Cancelled job' } },
      },
    },
    '/api/v1/storage/pools': {
      get: { operationId: 'listStoragePools', responses: { '200': { description: 'Storage pools' } } },
    },
    '/api/v1/settings': {
      get: { operationId: 'getSettings', responses: { '200': { description: 'Application settings' } } },
    },
  },
} as const;
