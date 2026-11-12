#!/usr/bin/env bash
# Point this clone at repo-managed hooks (pre-commit identity check).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
hook="$root/.githooks/pre-commit"
if [ ! -f "$hook" ]; then
  exit 0
fi
if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi
chmod +x "$hook"
current="$(git -C "$root" config --get core.hooksPath 2>/dev/null || true)"
if [ "$current" = ".githooks" ]; then
  exit 0
fi
git -C "$root" config core.hooksPath .githooks
if [ -z "${CI:-}" ]; then
  echo "Git hooks path set to .githooks (pre-commit identity check enabled)."
fi
