# Contributing

Thank you for considering a contribution to Fonds.

## What we care about

Fonds is built for **long-term preservation** and **minimal runtime dependencies**. Before you open a large PR:

- Prefer changes that keep archives readable without the original server or catalog.
- Avoid new runtime infrastructure (message brokers, extra databases, proprietary SDKs) unless there is a strong, documented reason.
- Do not change the on-disk archive format without a versioned migration and updates to [docs/archive-format/](docs/archive-format/).

For substantial design work, open an issue first.

## How to contribute

1. Fork the repository and create a branch from `main`.
2. Install dependencies and run tests (see [README.md](README.md)).
3. Keep commits focused; match existing code style (`pnpm lint`, `pnpm typecheck` when relevant).
4. Open a pull request with a clear description and test notes.

## Git commit identity

Commits must attribute work to the **`filoucool`** GitHub account, not the legacy address `felix@users.noreply.github.com` (that maps to a different user).

Allowed emails for human commits:

- `25182703+filoucool@users.noreply.github.com`
- `felix@nexumnet.com`

Hooks are installed when you run `pnpm install` (`core.hooksPath` → `.githooks`). To enable them on an existing clone without reinstalling:

```bash
./scripts/setup-git-hooks.sh
```

Use your normal `git config user.email` / `user.name`; do not override `GIT_AUTHOR_*` / `GIT_COMMITTER_*` with unscoped `@users.noreply.github.com` addresses.

## License

By contributing code, documentation, or other materials to this repository, you agree to license your contribution under the same terms as the project: the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE).

You represent that you have the right to license your contribution under these terms.
