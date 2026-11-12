#!/usr/bin/env bash
# Set repo-local user.name / user.email when git has no identity (e.g. fresh CI agents).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

if [ -z "$(git -C "$root" config --get user.email 2>/dev/null || true)" ]; then
  git -C "$root" config user.email "25182703+filoucool@users.noreply.github.com"
fi
if [ -z "$(git -C "$root" config --get user.name 2>/dev/null || true)" ]; then
  git -C "$root" config user.name "Félix Chenette-Stewart"
fi

# Drop old hooksPath from the identity-hook experiment if present.
hooks_path="$(git -C "$root" config --get core.hooksPath 2>/dev/null || true)"
if [ "$hooks_path" = ".githooks" ]; then
  git -C "$root" config --unset core.hooksPath
fi
