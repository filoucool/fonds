# Coverage audit (target: 95%)

This repo tracks **two different “coverage” meanings**. Hitting **95% everywhere** is the release gate; today you are **not** there yet — use the automated audit for current numbers.

## How to measure

```bash
pnpm test:coverage    # Vitest + v8 line coverage → coverage/coverage-summary.json
pnpm coverage:audit   # Merges lines + manifest behavioral scores → coverage-report.json
pnpm test:manifest    # Suite tag consistency for E2E
```

`coverage:audit` exits **non-zero** until all gate checks pass.

## Release gate (all must be ≥ 95%)

| Check | What it measures | Typical lever |
|-------|------------------|---------------|
| `backend.lines` | All instrumented TS under `packages/*/src` + `apps/api/src` | More integration + package unit tests |
| `backend.packages.lines` | Shared, archive-format, git-exec, cli, api-client | Fast: pure unit tests (json, glob, layout, sync) |
| `backend.services.lines` | `apps/api/src/services/*` | Extend `archive.test.ts` + dedicated service tests |
| `frontend.ui.manifest` | Weighted `done` / `partial` on `ui.*` + seed suites in `manifest.json` | E2E workflow specs |
| `frontend.ui.routes` | Top-level routes, 14 repo tabs, settings panels, login | Playwright navigation + `auth-flow` |

**Not in the line gate (by design today):** `apps/api/src/http/*` Nest controllers (~0% lines). They are thin wrappers; cover them with **HTTP integration tests** (`app.inject`) counted in manifest, or add a separate `api.http.lines` gate later.

**Frontend line coverage:** `apps/web` (~78 TS/Vue files) has **no** Vitest line report. “Frontend coverage” for release is **behavioral** (manifest + routes + 83 E2E tests), not Istanbul lines. Optional later: `apps/web/test` with `@vue/test-utils` for `lib/*` and dialogs.

## Snapshot (run `pnpm coverage:audit` for latest)

Approximate baseline after the first coverage run:

| Area | Line % | Behavioral % |
|------|--------|----------------|
| **Overall backend (instrumented)** | ~34% | — |
| **packages/** | ~12% | ~25% manifest `pkg.*` |
| **apps/api/services** | ~44% | ~40% manifest `svc.*` |
| **apps/api/http** | ~0% | Partial via E2E GET matrix |
| **UI (E2E)** | n/a | ~59% UI manifest; ~96% route surfaces (login gap) |

## Biggest line-coverage holes (backend)

Lowest-impact files to prioritize for **packages → 95%** first (small, deterministic):

- `packages/shared`: `json`, `glob`, `profiles`, `schedule`, `urls`
- `packages/archive-format`: `layout`, `manifest`, `atomic`, `checksums` (verify instrumentation in tests)
- `packages/git-exec`: `sync`, `serve`, `executor`
- `packages/cli` + `packages/api-client`: 0% today

Largest **service** files still under-tested:

- `search.ts`, `auth.ts`, `notifications.ts`, `worker.ts`, `recovery.ts`, `providers.ts`
- `catalog.ts` / `runner.ts` (~50% — extend import/provider scenarios)

## Roadmap to 95%

### Track A — Packages (days, high ROI)

1. Add `packages/shared/test/{json,glob,profiles,schedule}.test.ts`
2. Add `packages/archive-format/test/{layout,manifest,atomic}.test.ts`
3. Add `packages/git-exec/test/{sync,serve}.test.ts`
4. Add `packages/api-client/test/client.test.ts` + CLI tests with mocked `fetch`

**Gate:** `backend.packages.lines ≥ 95%`

### Track B — API services (weeks)

1. Split `apps/api/test/archive.test.ts` scenarios by domain (storage, search-index, browse blob)
2. Add `auth-http.test.ts` (session, CSRF) with Fastify inject
3. Add `git-http.test.ts` for smart HTTP
4. Preservation services: recovery, notifications, worker tick with `WORKER_ENABLED`

**Gate:** `backend.services.lines ≥ 95%`

### Track C — HTTP layer (parallel)

1. `apps/api/test/http-fastify.test.ts` — boot app on ephemeral port, hit representative GET/PATCH/POST for every controller group
2. Optionally add `api.http.lines` gate at 80% then 95%

### Track D — Frontend behavioral (weeks)

1. `auth-flow.spec.ts` — bootstrap + login (unblocks `/login` route score → ~100% routes)
2. Settings save flows per panel (PATCH + CSRF)
3. Import URL through UI, export download, classification editors
4. Mark manifest `ui.flow.*` and component tests as `done`

**Gate:** `frontend.ui.manifest ≥ 95%`

### Track E — Optional UI line coverage

1. Vitest + happy-dom/vue for `apps/web/src/lib/{format,route,labels}.ts`
2. Mount tests for `ExportDialog`, `JobActions`, `useCursorPager`

## CI recommendation

Until gates pass, run audit in CI **informational only**:

```yaml
- run: pnpm test:coverage
  continue-on-error: true
- run: pnpm coverage:audit
  continue-on-error: true
```

When `backend.packages.lines` and `frontend.ui.manifest` exceed 95%, flip to hard failures, then tighten service lines.
