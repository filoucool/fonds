#!/usr/bin/env bash
# Point this clone at repo-managed hooks (pre-commit identity check).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chmod +x "$root/.githooks/pre-commit"
git -C "$root" config core.hooksPath .githooks
echo "Git hooks path set to .githooks (pre-commit identity check enabled)."
