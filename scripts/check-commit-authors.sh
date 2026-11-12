#!/usr/bin/env bash
# Fail if any commit in RANGE uses legacy unscoped GitHub noreply author emails.
set -euo pipefail

if [ "${GITHUB_EVENT_NAME:-}" = pull_request ]; then
  base=""
  head=""
  if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "$GITHUB_EVENT_PATH" ]; then
    base=$(jq -r '.pull_request.base.sha // empty' "$GITHUB_EVENT_PATH")
    head=$(jq -r '.pull_request.head.sha // empty' "$GITHUB_EVENT_PATH")
  fi
  if [ -z "$base" ] && [ -n "${GITHUB_BASE_REF:-}" ]; then
    git fetch origin "$GITHUB_BASE_REF" --depth=1 2>/dev/null || true
    base=$(git merge-base "origin/${GITHUB_BASE_REF}" HEAD 2>/dev/null || true)
    head=HEAD
  fi
  if [ -z "$base" ]; then
    echo "check-commit-authors: could not resolve pull_request base sha" >&2
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

is_legacy_github_noreply() {
  local email="$1"
  [[ "$email" == *@users.noreply.github.com ]] && [[ "$email" != *+*@users.noreply.github.com ]]
}

check_email() {
  local sha="$1"
  local role="$2"
  local email="$3"
  if is_legacy_github_noreply "$email"; then
    echo "Commit ${sha:0:7}: ${role} ${email} uses legacy unscoped GitHub noreply." >&2
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
