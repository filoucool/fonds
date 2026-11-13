# Git access

Archives are **read-only**. Git smart HTTP and SSH serve clone/fetch only from `repository.git` under each archive id. Push is accepted only on **working copies** under `$DATA_DIR/working-repos/`.

## URLs

Set **Settings → Access & Git → Public base URL** (for example `https://fonds.example` or `http://127.0.0.1:8080`).

| Purpose | HTTP | SSH |
| --- | --- | --- |
| Clone archive | `{base}/git/archive/{repository-id}.git` | `ssh://git@{host}:{port}/archive/{repository-id}.git` |
| Push working copy | `{base}/git/working/{name}.git` | `ssh://git@{host}:{port}/working/{name}.git` |

Compose publishes SSH on host port **2222** by default when `gitAccess.sshEnabled` is true.

## Protected historical refs

Preserved refs live under `refs/archive/`. After clone, list them with:

```bash
git for-each-ref refs/archive/
```

They are ordinary refs in the bare repository; no special client flags are required beyond fetching what your refspec includes (default fetch includes all refs).

## Authentication

When app auth is not `trusted`, provide:

- **HTTPS:** `Authorization: Bearer <access-token>` with `git_fetch` or `git_push` scope.
- **SSH:** register the public key under **Settings → Git access** (API: `POST /api/ssh-keys`).

Upstream provider tokens (GitHub/GitLab) remain separate and are used only for synchronization.

## Working copies

Create a writable bare repo with `POST /api/working-repositories` (optional `fromArchiveRepositoryId` to seed from an archive). Pushes update only that working copy, not the preservation manifest or archive checksums.
