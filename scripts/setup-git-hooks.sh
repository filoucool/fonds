#!/usr/bin/env bash
# Point this clone at repo-managed hooks (pre-commit identity check).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$root/.githooks/pre-commit"
current="$(git -C "$root" config --get core.hooksPath 2>/dev/null || true)"
if [ "$current" = ".githooks" ]; then
  exit 0
fi
git -C "$root" config core.hooksPath .githooks
if [ -z "${CI:-}" ]; then
  echo "Git hooks path set to .githooks (pre-commit identity check enabled)."
fi
