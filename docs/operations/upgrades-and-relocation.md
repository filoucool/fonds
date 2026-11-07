# Upgrades and relocation

The process listens on port 8080. The data volume is `/data` (`DATA_DIR`). The named Compose volume is `archiver-data`. Catalog backups, the SQLite file, and pool directories all live on that volume. Moving or replacing the volume is how the archive moves between disks. Recreating the container does not rewrite archive format v1 in place.

## Start and restart

Build and start with:

```sh
docker compose up --build
```

Compose publishes `127.0.0.1:8080:8080`. Inside the container network namespace, `HOST=0.0.0.0` so the process accepts connections on the container interface that Compose forwards. The host-side publish address stays loopback.

The Compose restart policy is `unless-stopped`. Docker starts the container again after a daemon restart or a process crash. A container you stop stays stopped. The `archiver-data` volume persists across those restarts.

Phase 1 has no user login. The API is unauthenticated. Do not publish `0.0.0.0:8080` on the host unless that host is on a trusted network. Details are in [Security model](../security/model.md).

## Volume ownership

The entrypoint runs as root, chowns `/data`, and then the long-lived process runs as uid 10001 (`archiver`).

A named volume is handled by that chown. A bind mount of a host directory onto `/data` must be writable by uid 10001, or the entrypoint must be allowed to chown `/data`. A bind mount the process cannot write will fail catalog updates, job writes, and archive publishes.

## Upgrade

1. Pull the new image.
2. Restart the container (`docker compose up --build`, or an equivalent recreate of the same Compose project).

On startup the catalog migrations run forward. Pool directories are left as they are. Archive format v1 is not rewritten in place. A directory with a `schemaVersion` other than 1 is still refused for mutation and is skipped by rebuild. See [Archive format v1](../archive-format/v1.md).

Job behavior across the restart:

- `queued` jobs remain queued. The queue is in the catalog database on the data volume.
- A job that was `running` and whose lease expires is requeued. Heartbeats stop when the process dies, so the lease expires and the job is eligible again.
- Requeued work skips components already in state `complete`.
- Pause and cancel still abort the git subprocess of a job that has begun running.

A killed fetch does not publish and does not delete the existing bare repository. After restart, the next run of that job fetches into `refs/staging/*` again and publishes only through one `git update-ref --stdin` transaction.

## Free space

When free space on a pool is below that pool's threshold, downloads pause. Downloads resume when free space is back above the threshold. A job that continues skips components already `complete`.

## Move one archive between pools

Copy first. Point the catalog at the copy second. Delete the source last.

1. Copy the archive directory to the destination pool, preserving `archives/<2 hex>/<id>/`.
2. Verify the destination. `POST verify` runs `git fsck`, resolves manifest refs, and checks sha256 of `checksums.json` entries. It does not rewrite objects and does not re-download.
3. Update the catalog so the repository id points at the destination pool.
4. Delete the source directory only after the catalog update has succeeded.

A crash before the catalog update leaves the source in place. The catalog still points at the source.

`balancingEnabled` defaults to `false`. With that default, move archives with the order above.

## Relocate a pool or the whole data directory

Pause sync before the copy. Pause aborts an in-process git subprocess.

Pool directory moved, catalog file stayed:

1. Pause sync.
2. Copy or move the pool directory to the new disk path.
3. Register the new pool path.
4. Migrate archives that should live on that pool (copy, verify, update the catalog, then delete the source), or `POST /api/catalog/rebuild` if the catalog no longer has those rows.

Rebuild scans only `archives/<2 hex>/<id>/archive.json` under registered pools. It restores ids and labels. It reports identity conflicts without overwriting either side. It does not restore credentials. See [Backup and recovery](backup-recovery.md).

Whole `DATA_DIR` moved:

Moving the entire data directory is a bind-mount change. Stop the process, move the host directory, point the Compose volume or bind mount at the new path, and start again. The catalog and the pools move together, and paths inside `DATA_DIR` still resolve. The directory must be writable by uid 10001, or the entrypoint must chown `/data` on the next start.

Take a catalog backup and a pool copy before a relocation. The backup procedure is in [Backup and recovery](backup-recovery.md).

## Dependency inventory

Phase 1 records what the build used. It does not archive those dependencies.

- `pnpm inventory` runs `node scripts/write-inventory.mjs` and writes `docs/dependency-inventory.json`.
- After an image build, `scripts/record-image-digest.sh` records the image digest.

Automatic preservation of the dependencies listed in that inventory is Phase 3. Recursive dependency archiving, a managed offsite backup scheduler, and the rest of the Phase 2 and Phase 3 list are not in this build. They are named in [Architecture](../architecture/overview.md).
