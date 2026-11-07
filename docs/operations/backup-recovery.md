# Backup and recovery

Archive directories are the authority. `$DATA_DIR/app/catalog.sqlite` is a derived index. A full backup is a consistent copy of that database plus a copy of every pool directory. The database copy includes provider credentials, because credentials live only in SQLite. Archive manifests, sync records, and exports do not contain tokens. Protect catalog backups the way you protect those credentials. See [Security model](../security/model.md).

The catalog runs in WAL mode. The files next to it, when they exist, are `catalog.sqlite-wal` and `catalog.sqlite-shm`.

## Preferred catalog backup

Use this while the API is running.

1. Pause sync on repositories whose archives are being copied. Pause aborts the git subprocess. A fetch aborted this way does not publish.
2. `POST /api/maintenance/sqlite-backup`. The handler uses the SQLite backup API and writes one consistent database file under `$DATA_DIR/app/backups/`. The file includes provider credentials. The job queue is in this same catalog, so the file includes queued jobs.
3. Copy every pool directory, including each `archives/<2 hex>/<id>/` tree and the `archive.json` inside it.

Keep the backup file and the pool copy together. The backup file alone cannot rebuild git objects. The pools alone cannot restore provider tokens.

## Cold copy

Use this when you are copying the catalog without the backup API.

1. Stop the process.
2. Save the catalog in one of these ways:
   - Copy `$DATA_DIR/app/catalog.sqlite` together with `catalog.sqlite-wal` and `catalog.sqlite-shm` when those sidecars exist.
   - Open the stopped database, run `PRAGMA wal_checkpoint(TRUNCATE)`, then copy `catalog.sqlite`. After `TRUNCATE`, the main file holds the checkpointed pages.
3. Copy every pool directory.

Do not copy a live `catalog.sqlite` while the API is running unless you used `POST /api/maintenance/sqlite-backup`. A file copy of a live database, taken without the backup API and without a checkpoint, can omit WAL pages and will not restore.

## Restore when the catalog backup is intact

The pools stay. Only the database file is replaced.

1. Stop the process.
2. If the backup came from `POST /api/maintenance/sqlite-backup`, or from a checkpointed single file, replace `$DATA_DIR/app/catalog.sqlite` with that file. Remove any leftover `catalog.sqlite-wal` and `catalog.sqlite-shm` so SQLite does not replay an old WAL over the restored pages.
3. If the backup is the three-file cold copy, restore `catalog.sqlite`, `catalog.sqlite-wal`, and `catalog.sqlite-shm` as a set. Do not mix sidecars from a different run with a different main file.
4. Leave every pool directory in place.
5. Start the process. Catalog migrations run forward on startup.

The restored file replaces the catalog. Credentials and queued jobs in that backup return with it. Pool directories are unchanged.

## Restore when the catalog is lost

Archives on the pools are enough to restore ids and labels. They are not enough to restore credentials.

1. Start the process with an empty catalog and the pool directories in place. If a pool directory moved, register the new path before rebuild. Registering a path is described in [Upgrades and relocation](upgrades-and-relocation.md).
2. `POST /api/catalog/rebuild`.

Rebuild scans only `archives/<2 hex>/<id>/archive.json`. It restores ids and labels from those manifests. Directories that do not match that pattern are ignored.

Conflicts are reported and neither side is overwritten:

- the same archive id with a different identity (`source.identityKey`)
- the same identity with a different id

A `schemaVersion` other than 1 is reported and skipped. Rebuild does not modify that directory and does not register it.

Add provider credentials again after a rebuild. Nothing in the archive directory contains them.

## One repository

Export a single repository in any of these forms:

- git bundle: the bundle, plus a manifest, plus checksums
- portable directory: the archive directory itself (`archive.json`, `checksums.json`, `repository.git`, and the other v1 entries)
- package: a `tar.gz` of that directory

To register an exported directory on this or another instance, `POST /api/catalog/import-local` with a path that contains `archive.json`. Import verifies checksums before it registers the archive. It does not delete the source path. A checksum mismatch leaves the catalog unchanged for that import and leaves the source in place.

Import is the way to attach an archive when you do not have the original `catalog.sqlite`. The imported id remains the id stored in `archive.json`.

## Verify

`POST verify` checks an archive already on disk. It runs three checks:

- `git fsck` on `repository.git`, on `wiki/wiki.git` when present, and on any other bare git directory in the archive
- resolution of the refs recorded in the manifest (`refs.current` and `refs.archived`)
- sha256 of each entry in `checksums.json`, using the same rules as the format (archive-relative paths, symlinks hashed as link text and not followed, bare git directories left to `git fsck`)

Verify does not rewrite objects and does not re-download. A failed check is attributed to the component that failed.

Use verify on a destination pool before you delete a source pool. The required order is in [Upgrades and relocation](upgrades-and-relocation.md).
