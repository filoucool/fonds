# Security model

Phase 1 serves an unauthenticated API and an unauthenticated web UI. There is no user login. Anyone who can open the port can call the API, including catalog backup, import, verify, and purge.

Bind the process to loopback. The default listen address is `127.0.0.1:8080`. Compose publishes `127.0.0.1:8080:8080` and sets `HOST=0.0.0.0` only inside the container network namespace, so the forwarded port reaches the process. Do not publish `0.0.0.0:8080` on the host unless the host is on a trusted network.

Treat the Docker host, the data volume, and every catalog backup as credential stores.

## Remote URLs

User-supplied remotes may use `http`, `https`, `ssh`, and `git`.

`file` URLs and other local paths are accepted only when `settings.allowFileUrls` is true. The default is `false`.

These destinations are blocked:

- private addresses
- loopback
- link-local
- metadata addresses
- CGNAT
- any other non-global address

A blocked destination is allowed only when `allowPrivateNetworks` is enabled, or when the target matches an explicit exception. An exception is a hostname, an IP address, or an IPv4 CIDR.

DNS answers are checked before the connection and checked again when a redirect target is considered. Git HTTP redirects are disabled with `http.followRedirects=false`. Authorization headers are not forwarded across hosts. A redirect cannot carry a provider token to a different host.

The token used for an allowed remote is not placed in the URL.

## Git subprocess

Git is spawned with an argument array and a scrubbed environment. The remote, refspecs, and paths are arguments. They are not interpolated into a shell command.

Each invocation sets:

- `-c core.hooksPath=/dev/null`, so repository hooks do not run
- `alias.<command>` cleared, so a git alias cannot replace the command
- `credential.helper` empty
- `safe.directory=*`

The invocation does not recurse into submodules, does not run LFS smudge, does not read the user gitconfig, and does not pass proxy variables through the environment.

Authentication uses a temporary askpass environment. The askpass setup exists only for that subprocess. Tokens are not written into `repository.git` config, `wiki/wiki.git` config, or any other repo config. When the subprocess exits, the temporary askpass environment is gone. The stored copy of the credential remains in SQLite.

`git fetch --prune` is not used against the preserved namespace. Fetch writes `refs/staging/*` only. That constraint is the preservation rule; it also means a fetched refspec cannot delete `refs/archive/keep` or `refs/archive/history`.

## Archive contents are data

Repository file contents, paths inside the archive, and ref names are data. They are stored and checksummed. They are not executed, and they are not used as shell input.

Blob paths that contain `..` or that are absolute are rejected. Checksum paths in `checksums.json` are archive-relative and use forward slashes. Neither `archive.json` nor `checksums.json` records an absolute machine path.

Checksum walks do not follow symlinks. A symlink is hashed as the link text. A symlink whose target is outside the archive does not pull that target into the checksum or into the walk.

## Credentials, backups, and manifests

Provider credentials are rows in `$DATA_DIR/app/catalog.sqlite` and in consistent backups of that file produced by `POST /api/maintenance/sqlite-backup` (under `$DATA_DIR/app/backups/`) or by the cold-copy procedure. A pool copy of `archive.json`, `checksums.json`, `sync-records/`, or an export does not contain tokens.

Protect every file under `$DATA_DIR/app/backups/` and every cold copy of `catalog.sqlite`. Restrict who can read the data volume. A rebuilt catalog restores ids and labels from manifests and does not restore tokens; the tokens have to be entered again because they were never in the archive directory.

The application does not encrypt the catalog, the pools, or backups. Use disk encryption when the volume or the backup media must be unreadable at rest.

## Delete

Ordinary delete writes a tombstone. The archive is not removed by that action.

Permanent delete is `POST purge`. Purge requires the repository `displayName` to be typed back. A purge request that does not repeat that name does not permanently delete the repository.

## Acceptance

URL and path command-injection resistance, as required for Phase 1, means all of the following hold together:

- the protocol allowlist and the `settings.allowFileUrls` default reject unexpected URL schemes and local paths
- private, loopback, link-local, metadata, CGNAT, and other non-global addresses are rejected unless `allowPrivateNetworks` or an explicit hostname, IP, or IPv4 CIDR exception allows them
- DNS is checked before connect and again for redirects, Git HTTP redirects stay off, and Authorization is not sent across hosts
- git runs from an argument array in a scrubbed environment, with hooks, aliases, credential helpers, submodule recursion, LFS smudge, user gitconfig, and proxy variables disabled
- blob paths reject `..` and absolute paths, and checksum walks do not follow symlinks out of the archive

The rest of the Phase 1 matrix, including preservation and rebuild, is in [Architecture](../architecture/overview.md).
