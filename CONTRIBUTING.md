# Contributing

Thank you for considering a contribution to Fonds.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it. Report concerns using the enforcement contact described there.

## Branching

- **`develop`** is the default integration branch. Open pull requests against `develop`.
- **`master`** is reserved for releases. Maintainers merge from `develop` to `master` when cutting a release; do not target `master` for routine contributions.

Fork the repository and create your topic branch from `develop`.

## What we care about

Fonds is built for **long-term preservation** and **minimal runtime dependencies**. Before you open a large PR:

- Prefer changes that keep archives readable without the original server or catalog.
- Avoid new runtime infrastructure (message brokers, extra databases, proprietary SDKs) unless there is a strong, documented reason.
- Do not change the on-disk archive format without a versioned migration and updates to [docs/archive-format/](docs/archive-format/).

For substantial design work, open an issue first.

## How to contribute

1. Fork the repository and create a branch from `develop`.
2. Install dependencies and run tests (see [README.md](README.md)).
3. Keep commits focused; match existing code style (`pnpm lint`, `pnpm typecheck` when relevant).
4. Open a pull request against `develop` with a clear description and test notes.

## License

By contributing code, documentation, or other materials to this repository, you agree to license your contribution under the same terms as the project: the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE).

You represent that you have the right to license your contribution under these terms.
