# REST API and CLI

## Versioned API

- OpenAPI document: `GET /api/v1/openapi.json`
- Errors on `/api/v1/*` use a stable envelope: `{ "error": { "code", "message", "details?" } }`
- Write endpoints accept `Idempotency-Key` (for example `POST /api/v1/repositories/import`)

Trusted-network mode (default) allows unauthenticated access on the bind interface. Disable trusted mode in Settings → Access and create a local admin via `POST /api/auth/bootstrap` before first use on an exposed host.

Bearer tokens with the `api` scope work for automation (`ARCHIVER_TOKEN`).

## CLI

Build the CLI from the monorepo root:

```bash
pnpm --filter @repo-archive/cli build
node packages/cli/dist/main.js list
```

Or set `ARCHIVER_URL` and `ARCHIVER_TOKEN` and use the `repo-archive` binary after `pnpm build`.

### Remote commands (require a running server)

```bash
repo-archive list --format json
repo-archive inspect <repository-id>
repo-archive import <url>
repo-archive sync <repository-id>
repo-archive verify <repository-id>
repo-archive job <job-id>
repo-archive export <repository-id> --format bundle
repo-archive storage pools
```

### Offline rescue (no server)

```bash
repo-archive rescue verify <archive-directory>
repo-archive rescue rebuild-catalog <archives-root> [catalog.sqlite]
```

## TypeScript client

The workspace package `@repo-archive/api-client` wraps common v1 endpoints:

```bash
pnpm --filter @repo-archive/api-client build
```

```typescript
import { ArchiverClient } from '@repo-archive/api-client';

const client = new ArchiverClient({ baseUrl: 'http://127.0.0.1:8080', token: process.env.ARCHIVER_TOKEN });
const page = await client.listRepositories();
```
