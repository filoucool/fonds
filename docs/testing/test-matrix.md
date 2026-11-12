# Test matrix

Track implementation in [`manifest.json`](./manifest.json). Status legend: **done** | **partial** | **planned**.

## Summary

| Area | Vitest files today | E2E files today | Gap |
|------|-------------------|-----------------|-----|
| Packages | 3 | — | archive-format, cli, api-client, most of shared |
| API integration | 7 | — | per-route HTTP, git-http, auth CSRF |
| API readonly GET | — | 4 specs | repo-scoped GETs need seeded archive |
| UI navigation | — | 13+ specs | login, settings PATCH flows |
| UI workflows | — | 9 `ui-*.spec.ts` | second import via UI, classification save |

---

## Packages

### `@fonds/shared`

| Module | Behaviors to cover | Target file | Status |
|--------|-------------------|-------------|--------|
| `policy.ts` | URL allow/deny, private nets, file URLs | `packages/shared/test/policy.test.ts` | done |
| `urls.ts` | canonicalization, host parsing | `packages/shared/test/policy.test.ts` | partial |
| `json.ts` | `parseJson`, record guards | `packages/shared/test/json.test.ts` | planned |
| `glob.ts` | match semantics | `packages/shared/test/glob.test.ts` | planned |
| `schedule.ts` | cron / interval validation | `packages/shared/test/schedule.test.ts` | planned |
| `profiles.ts` | standard/minimal profiles | `packages/shared/test/profiles.test.ts` | planned |
| `components.ts` | component flags | `packages/shared/test/components.test.ts` | planned |
| `api-types.ts` | type guards / narrowing helpers | `packages/shared/test/api-types.test.ts` | planned |
| `phase2.ts` | phase2 DTO shapes | `packages/shared/test/phase2.test.ts` | planned |
| `phase3.ts` | phase3 DTO shapes | `packages/shared/test/phase3.test.ts` | planned |

### `@fonds/archive-format`

| Module | Behaviors | Target file | Status |
|--------|-----------|-------------|--------|
| `checksums.ts` | write, verify, tamper detect | `packages/archive-format/test/checksums.test.ts` | done |
| `layout.ts` | posix paths, git payload rules | `packages/archive-format/test/layout.test.ts` | planned |
| `manifest.ts` | archive.json schema | `packages/archive-format/test/manifest.test.ts` | planned |
| `atomic.ts` | atomic write | `packages/archive-format/test/atomic.test.ts` | planned |
| `backup-manifest.ts` | backup manifest | `packages/archive-format/test/backup-manifest.test.ts` | planned |

### `@fonds/git-exec`

| Module | Behaviors | Target file | Status |
|--------|-----------|-------------|--------|
| preservation / executor | protected refs, errors | `packages/git-exec/test/preservation.test.ts` | done |
| `sync.ts` | bare sync, ref publish | `packages/git-exec/test/sync.test.ts` | planned |
| `serve.ts` | upload-pack, pkt-line | `packages/git-exec/test/serve.test.ts` | planned |

### `@fonds/api-client` / `cli`

| Surface | Behaviors | Target file | Status |
|---------|-----------|-------------|--------|
| `FondsClient` | v1 list/import/sync paths | `packages/api-client/test/client.test.ts` | planned |
| CLI `list`…`export` | argv → HTTP | `packages/cli/test/main.test.ts` | planned |
| `rescue verify` | fixture tree | `packages/cli/test/rescue-verify.test.ts` | planned |
| `rescue rebuild-catalog` | sqlite rebuild | `packages/cli/test/rescue-catalog.test.ts` | planned |

---

## API — session (`/api`, `controllers.ts`)

| Method | Path | Integration | E2E GET | E2E workflow |
|--------|------|-------------|---------|--------------|
| GET | `health` | — | done | — |
| GET | `dashboard` | — | done | — |
| GET/PATCH | `settings` | planned | GET done | `ui.flow.settings-save` |
| GET | `repositories` | partial | done | — |
| POST | `repositories` | partial | — | `ui.flow.import-url` |
| POST | `repositories/import` | partial | — | planned |
| POST | `repositories/bulk` | planned | — | planned |
| GET/PATCH/DELETE | `repositories/:id` | partial | 404 done | planned |
| POST | `repositories/:id/restore` | planned | — | planned |
| POST | `repositories/:id/purge` | planned | — | planned |
| POST | `repositories/:id/sync` | done | — | planned |
| POST | `repositories/:id/verify` | partial | — | planned |
| POST | `repositories/:id/export` | partial | — | `ui.flow.export-dialog` |
| GET | `repositories/:id/refs` | planned | — | seeded |
| GET | `repositories/:id/commits` | planned | — | seeded |
| GET | `repositories/:id/tree` | partial | — | seeded |
| GET | `repositories/:id/blob` | planned | — | seeded |
| GET | `repositories/:id/blob/raw` | planned | — | seeded |
| GET | `repositories/:id/components` | planned | — | seeded |
| GET | `repositories/:id/events` | planned | — | seeded |
| GET | `repositories/:id/issues` | planned | — | seeded |
| GET | `repositories/:id/pulls` | planned | — | seeded |
| GET | `repositories/:id/discussions` | planned | — | seeded |
| GET | `repositories/:id/comments` | planned | — | seeded |
| GET | `repositories/:id/lfs` | planned | — | seeded |
| GET | `repositories/:id/releases` | planned | — | seeded |
| GET | `repositories/:id/assets/:assetId` | planned | — | seeded |
| GET | `repositories/:id/integrity` | partial | — | seeded |
| CRUD | `archival-profiles` | planned | list done | planned |
| CRUD | `sync-profiles` | planned | list done | planned |
| CRUD | `categories`, `tags`, `collections` | planned | list done | planned |
| GET/POST | `jobs`, lifecycle | partial | list done | `ui.flow.jobs-lifecycle` |
| CRUD | `storage/pools`, migrate | planned | list done | `ui.flow.storage-pool` |
| CRUD | `credentials` | planned | list done | planned |
| POST | `catalog/rebuild`, `import-local` | partial | — | planned |
| POST | `maintenance/sqlite-backup` | planned | — | planned |
| GET | `exports/:id`, download | partial | — | planned |
| GET | `inventory` | — | done | — |

## API — phase 2 (`phase2.controller.ts`)

| Method | Path | Status |
|--------|------|--------|
| POST | `auth/bootstrap`, `login`, `logout` | planned (`api.mutate.auth`, `ui.flow.login`) |
| GET | `auth/session` | E2E done |
| GET | `search` | E2E done |
| CRUD | `repositories/:id/search-index` | planned |
| GET | `repositories/:id/clone-urls` | planned |
| CRUD | `working-repositories` | planned |
| CRUD | `access-tokens`, `ssh-keys` | planned |
| GET | `audit-events` | E2E done |

## API — phase 3 (`phase3.controller.ts`)

| Method | Path | Status |
|--------|------|--------|
| GET/POST | `phase3/settings` | GET E2E done; POST planned |
| GET/POST | `backups`, retention | partial vitest; run E2E planned |
| CRUD | snapshots, diff, pin, retention | partial vitest |
| GET/POST | supply-chain | GET E2E done |
| dependencies discover/approve | | partial vitest |
| recovery | | planned |

## API — v1 (`v1.controller.ts`)

| Method | Path | Status |
|--------|------|--------|
| GET | `openapi.json` | done |
| GET | repositories, search, pools, settings | E2E done |
| POST | import, sync, verify, export, cancel | planned (`api.mutate.v1`) |

## Git smart HTTP (`git-http.ts`)

| Route | Status |
|-------|--------|
| `GET/POST /git/archive/:id/*` | planned |
| `GET/POST /git/working/:name/*` | planned |

---

## UI routes (`apps/web/src/router.ts`)

| Route | Navigation E2E | Content with data | Workflow |
|-------|----------------|-------------------|----------|
| `/dashboard` | done | partial | — |
| `/repositories` | done | planned | — |
| `/repositories/:id/overview` … `snapshots` (14 tabs) | shell done | `ui.repo.with-data.*` | `ui.flow.repo-overview-actions` |
| `/login` | planned | — | `ui.flow.login` |
| `/search` | done | partial | — |
| `/import` | done | — | `ui.flow.import-url` |
| `/jobs`, `/jobs/:id` | done | planned | `ui.flow.jobs-lifecycle` |
| `/storage` | done | planned | `ui.flow.storage-pool` |
| `/settings` + 12 panels | panels done | — | `ui.flow.settings-save` |
| `/inventory` | done | planned | — |
| `/preservation` | done | partial | `ui.flow.preservation-backup` |
| 404 | done | — | — |

### Settings panels

Appearance, Archival profiles, Sync profiles, Credentials, Access & Git & search, Git access credentials, Network, Queue, Placement, Categories, Tags, Collections — **panel headings**: E2E done; save/CRUD flows planned per panel.

### Shared components (unit / component tests)

`AppDialog`, `ExportDialog`, `JobActions`, `JobSteps`, `GlobalSearchBar`, `PagerBar`, `ProfileConfigFields`, `ScheduleFields` — planned under `apps/web/test/components/`.

### Composables / lib

`useCursorPager`, `useJobActions`, `format.ts`, `route.ts`, `labels.ts` — planned under `apps/web/test/`.

---

## Services (`apps/api/src/services/`)

| Service | Coverage today | Target |
|---------|----------------|--------|
| `catalog`, `runner`, `jobs`, `integrity` | `archive.test.ts` | extend browse/components |
| `auth`, `crypto` | `phase2.test.ts` | HTTP auth + CSRF |
| `backups`, `snapshots` | `phase3.test.ts` | recovery, retention apply |
| `storage`, `search`, `working-repos` | — | dedicated service tests |
| `supply-chain`, `recovery`, `notifications` | — | planned |
| `exporter`, `backup-transfer` | export-migration | edge cases |
| `git-access`, `git-ssh` | partial phase2 | git-http integration |

---

## CI workflow specs (priority order)

1. ~~**Seeded archive fixture**~~ **Done:** `e2e/tests/archive.setup.ts` (Playwright setup project) archives a local git repo; `repo-tabs-seeded.spec.ts` covers all 14 tabs.
2. **Import → job completes** → overview shows healthy (worker enabled in one project only).
3. **Auth mode**: bootstrap user, login, CSRF on PATCH settings.
4. **Storage**: create pool, migrate repo (integration + E2E).
5. **Export download** stream bytes + checksum.
6. **Phase 3 backup run** with worker.
7. **Git clone** against `/git/archive/:id` (spawn `git clone` in test).
8. **CLI smoke** against running API in vitest or CI job.

---

## Maintenance

- After adding a route in `controllers.ts`, update `apps/api/test/route-inventory.test.ts` and this matrix.
- After adding a vue route, update `e2e/fixtures/routes.ts` and `navigation.spec.ts`.
- Run `pnpm test:manifest` before release; aim for **100% done** on `layer: "e2e"` first (fast feedback), then vitest integration, then workflow specs.
