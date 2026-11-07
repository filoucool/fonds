# Architecture

Phase 1 is a private, self-hosted archive of Git repositories, run in Docker. Each archive directory is recoverable on its own. The SQLite catalog is an index derived from those directories. This phase is an archive, not a GitHub replacement.

The implementation is a TypeScript monorepo. The API is NestJS on Fastify. The UI is a Vue 3 static build served by that same API process. Git operations go through the native git CLI, one argument array per invocation.

## Runtime

The catalog is SQLite in WAL mode at `$DATA_DIR/app/catalog.sqlite`. The job queue is SQLite and runs in-process in that catalog. There is no Redis.

The data volume is `/data`, and that path is `DATA_DIR`. Pools live on the volume. The long-lived process runs as uid 10001 (`archiver`). The container entrypoint starts as root, fixes ownership of `/data`, and then the long-lived process continues as `archiver`.

The default bind is `127.0.0.1:8080`. Compose publishes `127.0.0.1:8080:8080` and sets `HOST=0.0.0.0` inside the container network namespace so the published port can reach the process. That `0.0.0.0` is the container interface.

## Packages

| Name | Role |
| --- | --- |
| `@repo-archive/shared` | Shared workspace package |
| `@repo-archive/archive-format` | Archive format v1 manifest, checksums, and content hash |
| `@repo-archive/git-exec` | git CLI invocations as argument arrays |
| `apps/api` (`@repo-archive/api`) | HTTP API and the static UI |
| `apps/web` (`@repo-archive/web`) | Vue 3 UI, built and served by the API |

The API entrypoint is `node apps/api/dist/main.js`.

## Modules

| Module | Responsibility |
| --- | --- |
| Catalog | Derived SQLite index. A lost catalog is rebuilt from archive directories. |
| Git preservation | Bare repository plus the archival ref namespace described below. |
| Providers | Generic git, GitHub, and GitLab. |
| Jobs | In-process queue: leases, heartbeats, pause, cancel, and requeue after a lost lease. |
| Sync | Per-repository profile and pause. |
| Integrity | `git fsck`, manifest ref resolution, and `checksums.json`. Verify does not rewrite objects or re-download. |
| Export | One repository as a git bundle (bundle, manifest, and checksums), a portable directory, or a `tar.gz` package. |
| Storage | Pools, the per-pool free-space threshold, and optional pool balancing. |

## On-disk layout

Every repository has a stable UUID. The UUID is the archive directory name and the catalog id.

```text
/data/pool-1/archives/ab/<id>/
  repository.git/     bare git, not a mirror clone
  archive.json
  checksums.json
  metadata/
  releases/
  lfs/objects/
  wiki/wiki.git/
  submodules/
  sync-records/
```

`pool-1` is one pool directory. `ab` is the two-hex shard. Catalog rebuild scans only paths that match `archives/<2 hex>/<id>/archive.json`. The manifest format is [archive format v1](../archive-format/v1.md). `storage.relativeLayout` for this tree is `v1`.

`repository.git` is a bare repository maintained by the publisher. It is not a mirror clone.

`archive.json`, files under `sync-records/`, and export manifests carry no credentials and no absolute machine paths. Provider tokens exist only in the SQLite catalog.

## Git ref model

The current upstream view is:

- `refs/heads`
- `refs/tags`
- `refs/notes`
- optional `refs/pull` or `refs/merge-requests`, when the provider has those refs

Before a current ref is moved or deleted, the previous object is stored at both of these names:

- `refs/archive/keep/<oid>`
- `refs/archive/history/<namespace>/<ref>/<timestamp>-<oid>`

`<namespace>` is the current-view namespace (`heads`, `tags`, `notes`, `pull`, or `merge-requests`). `<ref>` is the ref leaf under that namespace. `<oid>` is the object id the current ref pointed at before the update.

Fetch and publish are separate:

1. Fetch writes only under `refs/staging/*`.
2. The fetch uses explicit refspecs and `--no-tags`.
3. `git fetch --prune` is not used against the preserved namespace. Archival refs are never pruned.
4. A fetch that fails, or is killed, does not publish. It does not delete the existing bare repository.
5. The publisher applies one `git update-ref --stdin` transaction. That transaction is what moves the current view and records the archival refs.

Upstream branch deletion, tag deletion, force-push, and disappearance of the upstream leave the previous objects reachable. `refs/archive/keep/<oid>` still points at each previous object, so `git gc --prune=now` does not drop it.

## Component state

Component state is independent of job state. A component is one of:

`complete`, `partial`, `failed`, `unsupported`, `skipped`, `pending`, `running`, `paused`.

Generic git marks platform-only components `unsupported`. A component the profile disables is `skipped`. A skipped component is never reported as success.

## Jobs

A job is one of:

`queued`, `running`, `paused`, `partial`, `completed`, `failed`, `cancelled`.

A `running` job holds a lease and refreshes it with a heartbeat. After a restart, a stranded `running` job is requeued once its lease expires. Components already `complete` are not repeated.

Pause and cancel abort the git subprocess.

When free space on a pool falls below that pool's threshold, downloads pause. Downloads resume when free space is back above the threshold.

Queued jobs are rows in the catalog database, so they survive a process restart. See [Upgrades and relocation](../operations/upgrades-and-relocation.md).

## Sync and pools

Sync profiles are `manual`, `interval`, `daily`, `weekly`, and `monthly`. A profile has a timezone. Each repository can be paused on its own.

Pool balancing exists. `balancingEnabled` defaults to `false`.

## Credentials

Credentials are stored in SQLite and nowhere else. Git authentication uses a temporary askpass environment. The token is not placed in the remote URL and is not written into repository config. Backups of the catalog therefore contain provider tokens. Manifests, sync records, and exports do not. See [Security model](../security/model.md).

## Deferred

Phase 2 and Phase 3 are not implemented. Do not treat any of the following as present:

- code search
- Git serving
- user login
- public OpenAPI
- external CLI
- managed offsite backup scheduler
- recursive dependency archiving

`pnpm inventory` writes `docs/dependency-inventory.json`, and `scripts/record-image-digest.sh` records image digests after a build. Automatic preservation of those dependencies is Phase 3.

## Acceptance

Deferred items above are outside this matrix. Phase 1 is accepted when every row below holds.

| Check | Pass condition |
| --- | --- |
| Preservation under deletion and force-push | After upstream branch deletion, tag deletion, force-push, or disappearance of the upstream, previous objects stay reachable from `refs/archive/keep/<oid>`. `git gc --prune=now` does not drop them. A fetch that fails or is killed does not publish and does not delete the existing bare repository. |
| Profile omissions are explicit | A component disabled in the profile is `skipped` and is never reported as success. Generic git marks platform-only components `unsupported`. |
| Resumable jobs | A `running` job stranded by a restart is requeued when its lease expires. Components already `complete` are not repeated. Pause and cancel abort the git subprocess. |
| Export and import without the original SQLite catalog | Export yields a git bundle (bundle, manifest, and checksums), a portable directory, or a `tar.gz` package. `POST /api/catalog/import-local` on a path that contains `archive.json` verifies checksums before registering and does not delete the source. With pools in place and an empty catalog, `POST /api/catalog/rebuild` restores ids and labels. |
| Integrity attributes corruption to a component | `POST verify` runs `git fsck`, resolves manifest refs, and checks sha256 of `checksums.json` entries. It does not rewrite objects or re-download. A failed check is attributed to the affected component. |
| Storage threshold and migration ordering | Downloads pause below the pool free-space threshold and resume when space returns. A pool-to-pool move copies, verifies the destination, updates the catalog, and deletes the source only after that update. A crash before the catalog update leaves the source in place. |
| Offline read of local archives | An archive directory can be read with no connection to the upstream. The directory remains usable when the original `catalog.sqlite` is absent. |
| URL and path command injection resistance | Remotes are restricted to the allowed protocols. `file` and local paths require `settings.allowFileUrls` (default `false`). Private and other non-global addresses stay blocked unless `allowPrivateNetworks` or an explicit exception allows them. Git is spawned as an argument array with a scrubbed environment. Blob paths that contain `..` or are absolute are rejected. Checksum walks do not follow symlinks out of the archive. |

Operational procedures for backup, rebuild, upgrade, and disk moves are in [Backup and recovery](../operations/backup-recovery.md) and [Upgrades and relocation](../operations/upgrades-and-relocation.md).
