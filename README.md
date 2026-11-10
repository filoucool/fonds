# Archiver

Archiver is a private, self-hosted archive for Git repositories. It keeps a bare repository plus a versioned `archive.json`, and it stores the previous branch and tag tips before it accepts an upstream update. The SQLite catalog is an index. An archive directory can be rebuilt into the catalog after the database is lost.

Phase 1 is an archive, not a Git hosting service. Phase 2 adds optional search indexes, Git clone over HTTP/SSH (archives are read-only; pushes go to working copies), configurable auth (default trusted LAN), versioned `/api/v1`, and the `repo-archive` CLI. Bind to loopback or a trusted network unless auth and TLS are configured.

## Run with Docker

```bash
docker compose up --build
```

The UI and API listen on [http://127.0.0.1:8080](http://127.0.0.1:8080). Compose publishes that port on the host loopback only. Inside the container the process binds `0.0.0.0` so the published port can reach it.

Data is the named volume `archiver-data`, mounted at `/data`. The entrypoint starts as root, gives `/data` to uid 10001, and then the process continues as the `archiver` user. A restart keeps the volume, runs forward-only SQLite migrations, and requeues a running job whose lease expired. Completed components are not repeated.

To bind-mount a host directory instead:

```bash
mkdir -p ./data
docker compose run --rm --user root archiver chown -R 10001:10001 /data
```

Then replace the named volume in `compose.yaml` with `./data:/data`. Do not change the port mapping to `0.0.0.0:8080:8080` unless the host is on a trusted network.

## Run from a checkout

Node.js 22 and git are required.

```bash
pnpm install
pnpm --filter @repo-archive/web build
pnpm build:packages
pnpm --filter @repo-archive/api build
DATA_DIR=./data HOST=127.0.0.1 PORT=8080 node apps/api/dist/main.js
```

For UI development, run the API as above and, in another shell:

```bash
pnpm --filter @repo-archive/web dev
```

Vite serves the UI at [http://127.0.0.1:5173](http://127.0.0.1:5173) and proxies `/api` to port 8080.

## Tests

```bash
pnpm test
```

End-to-end tests (Playwright against the built API and UI):

```bash
pnpm test:e2e
```

With the app already built and running on port 8080:

```bash
E2E_PORT=8080 CI= pnpm --filter @repo-archive/e2e test
```

The preservation tests create local Git repositories, delete branches and tags, force-push, and run `git gc --prune=now`. Archived commits remain readable.

## Operations

- [REST API and CLI](docs/operations/api-cli.md)
- [Git access (HTTP/SSH)](docs/operations/git-access.md)
- [Architecture](docs/architecture/overview.md)
- [Archive format v1](docs/archive-format/v1.md)
- [Backup and recovery](docs/operations/backup-recovery.md)
- Phase 3 **Preservation** UI (`/preservation`) and API (`/api/phase3/*`) for managed backups, snapshots, dependency discovery, and self-preservation reports
- [Upgrades and disk relocation](docs/operations/upgrades-and-relocation.md)
- [Security model](docs/security/model.md)

A consistent catalog backup is `POST /api/maintenance/sqlite-backup`. It uses the SQLite backup API and writes under `$DATA_DIR/app/backups/`. Copy the pool directories as well. The pools are the archive. The database is the index.

Dependency names, versions, licenses, and upstream links are generated with:

```bash
pnpm inventory
```

After `docker build`, record the image digest with:

```bash
sh scripts/record-image-digest.sh archiver:local
```

Automatic preservation of those dependencies is deferred to Phase 3.
