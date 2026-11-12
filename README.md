# Fonds

**Self-hosted preservation for Git repositories.** Not a hosting platform: an archive you can still read decades from now.

Fonds keeps a **bare Git repository** plus a versioned on-disk manifest (`archive.json`) for every project you care about. Before each upstream update it records previous branch and tag tips in a dedicated ref namespace so force-pushes, deletions, and upstream disappearances do not erase history you already captured.

The **archive directories on disk are the source of truth**. The SQLite catalog is a derived index: if the database is lost, the catalog can be rebuilt by scanning pools. Exports are designed to be useful without the original server.

## Table of contents

- [Design goals](#design-goals)
- [Features](#features)
- [Quick start (Docker)](#quick-start-docker)
- [Run from a checkout](#run-from-a-checkout)
- [Tests](#tests)
- [Documentation](#documentation)
- [Operations](#operations)
- [Contributing](#contributing)
- [License](#license)

## Design goals

### Preserve Git history, not just mirror it

Upstream refs stay current, but every superseded tip is also stored under `refs/archive/keep/` and `refs/archive/history/`. Preservation tests run branch and tag deletion, force-push, and `git gc --prune=now`; archived commits remain reachable.

Fetch and publish are separate: a failed or interrupted fetch does not publish and does not replace the existing bare repository. `git fetch --prune` is never applied to the preserved namespace.

### Self-preservation with minimal dependencies

The project aims for long-term self-preservation. That drives technical choices:

| Principle | What we do |
| --- | --- |
| **Few moving parts** | One API process serves the UI and REST API. Job queue lives in SQLite (no Redis, no external broker). |
| **Git is the engine** | Repository operations go through the native `git` CLI (argument arrays, scrubbed environment), not a heavy Git library stack. |
| **Recoverable without the server** | Each archive folder is self-describing (`archive.json`, checksums, bare `repository.git`). Import and catalog rebuild work from disk alone. |
| **Know what we depend on** | `pnpm inventory` writes `docs/dependency-inventory.json` (names, versions, licenses, upstream links). After `docker build`, `scripts/record-image-digest.sh` records image digests. |
| **Preserve dependencies too (roadmap)** | Phase 3 adds managed backups, snapshots, a dependency graph, and automated preservation of build/runtime dependencies so the project (and its toolchain) can be archived alongside your repos. |

Runtime dependencies stay small: **Node.js, SQLite, and Git**, plus whatever you configure for optional Phase 2 features (search, HTTP/SSH Git access, auth). We avoid extra infrastructure you would need to keep running just to read an archive.

### Self-hosted by default

Bind to loopback or a trusted network unless you have configured authentication and TLS. Phase 2 adds configurable auth (default: trusted LAN), versioned `/api/v1`, OpenAPI, the `fonds` CLI, and read-only archive access over HTTP/SSH with separate writable working copies for pushes.

## Features

- **Multi-provider sync:** generic Git, GitHub, and GitLab profiles with schedules and per-repo pause.
- **Resumable jobs:** leases, heartbeats, and requeue after restart; completed steps are not repeated.
- **Integrity:** verify via `git fsck`, manifest ref resolution, and `checksums.json` without re-downloading objects.
- **Export:** git bundle, portable directory, or `tar.gz` package; import and catalog rebuild without the original database.
- **Storage pools:** sharded archive layout, free-space thresholds, optional balancing.
- **Phase 2 (in progress / optional):** search indexes, Git clone over HTTP/SSH, `fonds` CLI including offline rescue commands.
- **Phase 3 (Preservation UI):** managed backups, snapshots, dependency discovery, and self-preservation reports (`/preservation`, `/api/phase3/*`).

## Quick start (Docker)

**Requirements:** Docker with Compose.

```bash
docker compose up --build
```

Open **[http://127.0.0.1:8080](http://127.0.0.1:8080)**. Compose publishes port `8080` on the host loopback only. Inside the container the process binds `0.0.0.0` so the published port can reach it.

**Data** lives in the named volume `fonds-data`, mounted at `/data`. The entrypoint fixes ownership for uid `10001`, then runs as the `fonds` user. On restart, SQLite migrations run forward-only and expired job leases are requeued.

**Host directory instead of a named volume:**

```bash
mkdir -p ./data
docker compose run --rm --user root fonds chown -R 10001:10001 /data
```

Edit `compose.yaml` and replace the named volume with `./data:/data`. Avoid mapping `0.0.0.0:8080:8080` unless the host is on a network you trust.

## Run from a checkout

**Requirements:** Node.js **22**, Git, and [pnpm](https://pnpm.io/) (see `packageManager` in `package.json`).

```bash
pnpm install
pnpm --filter @fonds/web build
pnpm build:packages
pnpm --filter @fonds/api build
DATA_DIR=./data HOST=127.0.0.1 PORT=8080 node apps/api/dist/main.js
```

**UI development:** keep the API running, then:

```bash
pnpm --filter @fonds/web dev
```

Vite serves the UI at [http://127.0.0.1:5173](http://127.0.0.1:5173) and proxies `/api` to port `8080`.

**Full production build:**

```bash
pnpm build
```

## Tests

```bash
pnpm test
```

End-to-end (Playwright, built API + UI):

```bash
pnpm test:e2e
```

Against an app already running on port `8080`:

```bash
E2E_PORT=8080 CI= pnpm --filter @fonds/e2e test
```

Preservation scenarios use local Git repositories, destructive upstream actions, and aggressive GC; archived objects must stay readable.

## Documentation

| Topic | Link |
| --- | --- |
| Architecture | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Archive format v1 | [docs/archive-format/v1.md](docs/archive-format/v1.md) |
| REST API and CLI | [docs/operations/api-cli.md](docs/operations/api-cli.md) |
| Git access (HTTP/SSH) | [docs/operations/git-access.md](docs/operations/git-access.md) |
| Backup and recovery | [docs/operations/backup-recovery.md](docs/operations/backup-recovery.md) |
| Upgrades and disk moves | [docs/operations/upgrades-and-relocation.md](docs/operations/upgrades-and-relocation.md) |
| Security model | [docs/security/model.md](docs/security/model.md) |
| Testing | [docs/testing/README.md](docs/testing/README.md) |

## Operations

**Catalog backup:** `POST /api/maintenance/sqlite-backup` uses the SQLite backup API and writes under `$DATA_DIR/app/backups/`. Copy **pool directories** as well; pools hold the archives, the database is the index.

**Dependency inventory:**

```bash
pnpm inventory
```

**Record container image digest after build:**

```bash
sh scripts/record-image-digest.sh fonds:local
```

## Contributing

Fonds is an open source project. Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, test expectations, and how contributions are licensed.

## License

Copyright (C) 2025 Félix Chenette-Stewart.

Fonds is licensed under the **[GNU Affero General Public License v3.0](LICENSE)** (AGPL-3.0). You may use, modify, and redistribute the software under those terms. **Commercial use is allowed** when you comply with the license (including offering corresponding source when you provide a modified version as a network service).

## Project layout

```
apps/api/          HTTP API (NestJS on Fastify) + serves built UI
apps/web/          Vue 3 UI
packages/
  archive-format/  Manifest, checksums, layout v1
  git-exec/        Git CLI invocations
  cli/             fonds CLI
  shared/          Shared types and policy
```

See [Design goals](#design-goals) for the preservation and minimal-dependency constraints that guide design review.
