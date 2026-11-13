# Security

## Reporting vulnerabilities

If you believe you have found a security issue in Fonds, please report it privately rather than opening a public issue.

1. Use [GitHub private security advisories](https://github.com/OWNER/REPO/security/advisories/new) for this repository (replace `OWNER/REPO` with `GITHUB_REPOSITORY`, e.g. `myorg/archiver`) if you have access, **or**
2. Open a minimal public issue asking for a private contact channel (do not include exploit details in the issue).

Include steps to reproduce, affected version or commit, and the impact you believe it has.

We aim to acknowledge reports within a few business days. Fixes for confirmed issues are released through normal releases on the `master` branch and container images on GHCR.

## Deployment defaults (read this first)

**Default authentication mode is `trusted`:** the REST API and web UI do not require login. Anyone who can reach the listening port can import repositories, change settings, read provider tokens from the catalog, run maintenance, and permanently purge archives.

- Bind to **loopback** (`127.0.0.1`) for single-user or laptop use.
- Docker Compose publishes `127.0.0.1:8080:8080` on the host by design.
- Do **not** expose Fonds on an untrusted network until you have enabled **local** authentication and created accounts (see below).

### Enabling local authentication

1. While still on a trusted network (or loopback), create the first admin: `POST /api/auth/bootstrap` with username and password (minimum 12 characters). This creates the user and switches mode to `local`.
2. Optional: set `auth.mode` to `local` in settings only **after** at least one user exists (the API enforces this).
3. Configure HTTPS or a reverse proxy in production. Set `auth.requireHttpsForLogin` to reject login over plain HTTP; otherwise session cookies are marked `Secure` only when the login request is HTTPS.

OpenID Connect (`oidc`) is **not implemented**; the API rejects selecting that mode.

Notification email (`settings.notifications.emailEnabled`) and user TOTP (`users.totp_secret`) are **not implemented**; they are stored for forward compatibility only. See [docs/security/model.md](docs/security/model.md).

## Credential storage

Provider tokens and Git-access credentials live in SQLite at `$DATA_DIR/app/catalog.sqlite`. Catalog backups made via the API copy those secrets. Archive directories (`archive.json`, pools, exports) do **not** contain upstream tokens.

Protect the data directory, backup files, and anyone with host access to the container.

## Further reading

Detailed threat model, URL policy, and Git subprocess hardening: [docs/security/model.md](docs/security/model.md).
