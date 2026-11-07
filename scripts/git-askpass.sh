#!/bin/sh
prompt=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
case "$prompt" in
  *username*)
    [ -n "${ARCHIVER_GIT_USERNAME:-}" ] || exit 1
    printf '%s\n' "$ARCHIVER_GIT_USERNAME"
    ;;
  *password*)
    [ -n "${ARCHIVER_GIT_TOKEN:-}" ] || exit 1
    printf '%s\n' "$ARCHIVER_GIT_TOKEN"
    ;;
  *)
    exit 1
    ;;
esac
