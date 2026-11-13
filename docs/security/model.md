# Security model

Fonds combines **preservation semantics** (Phase 1) with **optional access control** (Phase 2). This document describes both. Defaults are chosen for a single operator on loopback; exposing the service on a wider network requires explicit hardening.

## Authentication and exposure

### Default: trusted mode

Fresh installs use `auth.mode: trusted`. In this mode:

- The REST API and web UI **do not require login**.
- Anyone who can open the HTTP port can call mutating endpoints: import, sync, settings changes, credential storage, catalog backup, and repository purge (purge still requires typing the repository name).
- Optional Git smart HTTP and SSH, when enabled, also allow anonymous clone/fetch unless you switch to local auth.

**Treat trusted mode like root on the host.** Bind to loopback (`127.0.0.1:8080` from checkout; Compose maps `127.0.0.1:8080:8080` on the host while the process listens on `0.0.0.0` inside the container).

### Local mode

When `auth.mode` is `local`:

- Most `/api/*` routes require a **session cookie** or a **Bearer token** with the `api` scope.
- Browser sessions use an HTTP-only cookie; mutating requests from the UI must send the matching **`X-CSRF-Token`** header.
- `POST /api/auth/bootstrap` and `POST /api/auth/login` stay reachable without a session. Bootstrap is allowed only while no admin account exists (or bootstrap has not been completed with existing users, per server rules).
- At least one local user must exist before settings can switch from `trusted` to `local` (bootstrap creates the first user and enables local mode).

When `auth.requireHttpsForLogin` is true, `POST /api/auth/bootstrap` and `POST /api/auth/login` are rejected unless the request is HTTPS (direct TLS or `X-Forwarded-Proto: https` from a reverse proxy). Session cookies are marked `Secure` when the login request is HTTPS or when this setting is enabled.

### OpenID Connect

`oidc` appears in shared types for forward compatibility. **It is not implemented.** The API rejects `auth.mode: oidc` in settings patches.

### Git access (HTTP / SSH)

When `gitAccess.httpEnabled` or SSH is on:

- In **trusted** mode, smart HTTP does not require Git credentials (same trust boundary as the API).
- In **local** mode, fetch requires a session or a token with `git_fetch`; push to a **working** copy requires `git_push`. Archive remotes are read-only for receive-pack.

Access tokens (`ra_…` prefix) and user SSH public keys are stored in SQLite separately from upstream provider tokens.

### API versioning

`/api/v1` uses the same authentication rules as `/api` when local auth is enabled, plus per-IP rate limiting on mutations. See [Operations](../operations/api-cli.md).

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

Settings patches cannot change `auth.bootstrapCompleted`; use bootstrap and normal operation instead.

## Delete

Ordinary delete writes a tombstone. The archive is not removed by that action.

Permanent delete is `POST purge`. Purge requires the repository `displayName` to be typed back. A purge request that does not repeat that name does not permanently delete the repository.

## Acceptance

URL and path command-injection resistance means all of the following hold together:

- the protocol allowlist and the `settings.allowFileUrls` default reject unexpected URL schemes and local paths
- private, loopback, link-local, metadata, CGNAT, and other non-global addresses are rejected unless `allowPrivateNetworks` or an explicit hostname, IP, or IPv4 CIDR exception allows them
- DNS is checked before connect and again for redirects, Git HTTP redirects stay off, and Authorization is not sent across hosts
- git runs from an argument array in a scrubbed environment, with hooks, aliases, credential helpers, submodule recursion, LFS smudge, user gitconfig, and proxy variables disabled
- blob paths reject `..` and absolute paths, and checksum walks do not follow symlinks out of the archive

Preservation and catalog rebuild behavior are in [Architecture](../architecture/overview.md). Vulnerability reporting: [SECURITY.md](../../SECURITY.md) at the repository root.
