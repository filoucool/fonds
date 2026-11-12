# REST API and CLI

## Versioned API

- OpenAPI document: `GET /api/v1/openapi.json`
- Errors on `/api/v1/*` use a stable envelope: `{ "error": { "code", "message", "details?" } }`
- Write endpoints accept `Idempotency-Key` (for example `POST /api/v1/repositories/import`)

Trusted-network mode (default) allows unauthenticated access on the bind interface. Disable trusted mode in Settings → Access and create a local admin via `POST /api/auth/bootstrap` before first use on an exposed host.

Bearer tokens with the `api` scope work for automation (`FONDS_TOKEN`).

## CLI

Build the CLI from the monorepo root:

```bash
pnpm --filter @fonds/cli build
node packages/cli/dist/main.js list
```

Or set `FONDS_URL` and `FONDS_TOKEN` and use the `fonds` binary after `pnpm build`.

### Remote commands (require a running server)

```bash
fonds list --format json
fonds inspect <repository-id>
fonds import <url>
fonds sync <repository-id>
fonds verify <repository-id>
fonds job <job-id>
fonds export <repository-id> --format bundle
fonds storage pools
```

### Offline rescue (no server)

```bash
fonds rescue verify <archive-directory>
fonds rescue rebuild-catalog <archives-root> [catalog.sqlite]
```

## TypeScript client

The workspace package `@fonds/api-client` wraps common v1 endpoints:

```bash
pnpm --filter @fonds/api-client build
```

```typescript
import { FondsClient } from '@fonds/api-client';

const client = new FondsClient({ baseUrl: 'http://127.0.0.1:8080', token: process.env.FONDS_TOKEN });
const page = await client.listRepositories();
```
