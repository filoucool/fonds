# Testing strategy

Goal: **pre-release confidence from CI only** — unit and package tests for pure logic, Vitest integration tests for catalog/jobs/archive behavior, Playwright for every UI route shell and readonly API surface, then deeper workflow specs as the matrix rows flip to `done`.

## Layers

| Layer | Runner | Location | What it proves |
|-------|--------|----------|----------------|
| Unit | Vitest | `packages/*/test`, small `apps/api` units | Pure functions, format, policy, crypto, git helpers |
| Integration | Vitest | `apps/api/test` | Real SQLite + data dir: import, sync, verify, export, phase3 |
| API smoke (readonly) | Playwright `request` | `e2e/tests/api-*.spec.ts` | Every safe GET returns 2xx and a stable JSON shape |
| UI navigation | Playwright | `e2e/tests/navigation*.spec.ts` | SPA routes resolve, headings, settings panels, repo tabs |
| UI workflows | Playwright | `e2e/tests/*-flow.spec.ts` | Multi-step flows (import, job cancel, storage migrate, …) |
| Git HTTP | Vitest or Playwright | TBD per matrix | `git-upload-pack` / `info/refs` against a seeded archive |
| CLI | Vitest | `packages/cli/test` | Command parsing + mocked HTTP; `rescue verify` on fixture tree |
| Docker / image | CI job `image` | `.github/workflows/ci.yml` | Production image builds |

## Working the matrix

1. Pick a row in [`test-matrix.md`](./test-matrix.md) with status `planned` or `partial`.
2. Implement the test in the file named in the **Target file** column (create the file if missing).
3. Tag the test with a manifest id: `test('…', { tag: '@suite ui.route.jobs' }, …)` or a leading comment `// @suite api.get.jobs`.
4. Run locally:
   - `pnpm test`
   - `pnpm test:e2e` (builds app + Playwright; needs Chromium)
   - `pnpm test:manifest` (coverage report vs manifest)
5. Set the row status to `done` in [`manifest.json`](./manifest.json) and adjust counts.

## Local commands

E2E uses a **setup project** (`e2e/tests/archive.setup.ts`) that archives a local git repo before browser tests run. State is written to `e2e/fixtures/seed-state.json` (gitignored). The API server runs with `WORKER_ENABLED=true` so import jobs finish during setup.

```bash
pnpm typecheck && pnpm test
pnpm build && pnpm --filter @repo-archive/e2e test
pnpm test:manifest
pnpm test:coverage && pnpm coverage:audit
```

See **[coverage-audit.md](./coverage-audit.md)** for the 95% release gate and gap analysis.

## CI today

- Job **test**: `typecheck`, Vitest, web build, dependency inventory.
- Job **e2e**: full build, Playwright (Chromium), uploads report on failure.
- Job **image**: `docker build`.

No merge gate on manifest coverage percentage yet; run `pnpm test:manifest` in CI when the `done` ratio is high enough to avoid noise.
