# Fonds

<dl>
<dt><strong>fonds</strong></dt>
<dd>
<em>n.</em>
<p>the entire body of records of an organization, family, or individual that have been created and accumulated as the result of an organic process reflecting the functions of the creator</p>
</dd>
</dl>

---

In archives, a **fonds** is more than a single box of files. It is the body of records that built up while a creator was doing real work, kept together because they share the same origin. Software has something like that too: commits, tags, releases, and refs that show how a project actually evolved. That history is worth keeping, not only whatever is on `main` right now.

Many of us still treat a Git host as the archive. Hosting is custody, not preservation. A mirror chases the present; it does not always keep what was true yesterday. Force-pushes and deleted branches drop older tips. Accounts lock. Lawsuits against individual maintainers and against organizations show up as repositories that disappear or sit frozen on the host. When most open source lives on one provider, policy and legal pressure can hit a lot of projects at once. Running your own archive is one way to keep a copy that does not depend on a single vendor's timeline.

**Fonds** is for people who want a fonds of their own Git work: solo maintainers, teams, and anyone who needs a durable record. It is **self-hosted preservation for Git repositories**, not another hosting platform. It is an archive you can still read decades from now, even if the upstream or the service around it is gone.

Fonds keeps a **bare Git repository** plus a versioned on-disk manifest (`archive.json`) for every project you register. Before each upstream update it records previous branch and tag tips in a dedicated ref namespace so force-pushes, deletions, and upstream disappearances do not erase history you already captured. The **archive directories on disk are the source of truth**. The SQLite catalog is a derived index: if the database is lost, the catalog can be rebuilt by scanning pools. Exports are designed to be useful without the original server.

## Table of contents

- [Design goals](#design-goals)
- [Features](#features)
  - [Roadmap](#roadmap)
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
| **Preserve dependencies too (roadmap)** | Planned: managed backups, snapshots, a dependency graph, and automated preservation of build/runtime dependencies so the project (and its toolchain) can be archived alongside your repos. |

Runtime dependencies stay small: **Node.js, SQLite, and Git**, plus whatever you configure for optional features (search, HTTP/SSH Git access, auth). We avoid extra infrastructure you would need to keep running just to read an archive.

### Self-hosted by default

Bind to loopback or a trusted network unless you have configured authentication and TLS. The server also offers configurable auth (default: trusted LAN), versioned `/api/v1`, OpenAPI, the `fonds` CLI, and read-only archive access over HTTP/SSH with separate writable working copies for pushes.

## Features

- **Multi-provider sync:** generic Git, GitHub, and GitLab profiles with schedules and per-repo pause.
- **Resumable jobs:** leases, heartbeats, and requeue after restart; completed steps are not repeated.
- **Integrity:** verify via `git fsck`, manifest ref resolution, and `checksums.json` without re-downloading objects.
- **Export:** git bundle, portable directory, or `tar.gz` package; import and catalog rebuild without the original database.
- **Storage pools:** sharded archive layout, free-space thresholds, optional balancing.
- **Search, CLI & Git access (optional):** search indexes, Git clone over HTTP/SSH, `fonds` CLI including offline rescue commands.
- **Preservation:** managed backups, snapshots, dependency discovery, and self-preservation reports (UI at `/preservation` plus matching REST endpoints).

### Roadmap

Planned enhancements (not yet implemented):

- **Point-in-time restore:** republish or export a repository view from a chosen archival ref without discarding newer preserved objects.
- **Bulk register & sync:** add many remotes at once (CSV, org URL, or token-scoped provider listing) with shared profile defaults.
- **Bitbucket & Gitea/Forgejo profiles:** provider adapters alongside GitHub and GitLab for metadata and platform-specific refs where available.
- **Stale upstream detection:** surface renamed, deleted, or inaccessible remotes with a guided relink flow.
- **Submodule & nested-repo policy:** per-profile rules to archive submodule SHAs, shallow submodule clones, or skip with explicit `unsupported` status.
- **Full source-text indexing:** capability-aware search (`metadata`, `filenames`, `source_text`) with disk budget and exclude globs.
- **Global search UI:** search across repositories with filters for pool, provider, sync status, and integrity.
- **In-browser blame & history:** commit history and blame for paths without leaving the archive UI.
- **OIDC login & scoped API tokens:** external identity, session TTL, and tokens scoped to API vs Git fetch/push.
- **Writable working copies:** sandboxes for allowed pushes that preserve fetch/publish separation and archival refs.
- **Dependency graph & toolchain archive:** inventory runtime and build dependencies, relate them in a graph, and preserve the Fonds toolchain alongside user repos.
- **`fonds rescue` offline toolkit:** verify, rebuild the catalog, and export from copied pool data with no server process.
- **LFS integrity audit:** report missing pointers and orphaned LFS objects, with optional re-fetch when credentials still work.
- **Job SLO dashboard:** queue depth, sync duration percentiles, failure rates, and lease timeouts over time.
- **IP allowlists & mTLS:** network-level access control beyond OIDC for trusted LAN or edge deployment.
- **Token rotation assistant:** track expiring provider credentials and warn before sync begins to fail.
- **Preservation attestation pack:** one download with fsck summary, checksum coverage, image digest, dependency inventory, and an auditor-facing cover sheet.

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
| Reporting vulnerabilities | [SECURITY.md](SECURITY.md) |
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

Fonds is an open source project. Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, test expectations, and how contributions are licensed. Participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

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
