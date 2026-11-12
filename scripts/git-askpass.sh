#!/bin/sh
prompt=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
case "$prompt" in
  *username*)
    [ -n "${FONDS_GIT_USERNAME:-}" ] || exit 1
    printf '%s\n' "$FONDS_GIT_USERNAME"
    ;;
  *password*)
    [ -n "${FONDS_GIT_TOKEN:-}" ] || exit 1
    printf '%s\n' "$FONDS_GIT_TOKEN"
    ;;
  *)
    exit 1
    ;;
esac
