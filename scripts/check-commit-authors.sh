#!/usr/bin/env bash
# Fail if any commit in RANGE uses author/committer emails that map to the wrong GitHub user.
set -euo pipefail

FORBIDDEN='felix@users.noreply.github.com'

if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  base="${GITHUB_EVENT_PULL_REQUEST_BASE_SHA:-}"
  head="${GITHUB_EVENT_PULL_REQUEST_HEAD_SHA:-HEAD}"
  if [ -z "$base" ]; then
    echo "check-commit-authors: missing base SHA for pull_request" >&2
    exit 1
  fi
  range="${base}..${head}"
else
  before="${GITHUB_EVENT_BEFORE:-}"
  after="${GITHUB_SHA:-HEAD}"
  if [ -z "$before" ] || [ "$before" = "0000000000000000000000000000000000000000" ]; then
    range="$after"
  else
    range="${before}..${after}"
  fi
fi

failed=0

check_email() {
  local sha="$1"
  local role="$2"
  local email="$3"
  if [ "$email" = "$FORBIDDEN" ]; then
    echo "Commit ${sha:0:7}: ${role} ${email} is forbidden (wrong GitHub contributor)." >&2
    failed=1
    return
  fi
  if [[ "$email" == *@users.noreply.github.com ]] && [[ "$email" != *"+filoucool@"* ]] && [[ "$email" != *"dependabot"* ]]; then
    echo "Commit ${sha:0:7}: ${role} ${email} — use 25182703+filoucool@users.noreply.github.com." >&2
    failed=1
  fi
}

while read -r sha; do
  [ -z "$sha" ] && continue
  mapfile -t emails < <(git show -s --format='%ae%n%ce' "$sha")
  check_email "$sha" author "${emails[0]}"
  check_email "$sha" committer "${emails[1]}"
done < <(git rev-list --no-merges "$range" 2>/dev/null || true)

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "check-commit-authors: ok ($range)"
