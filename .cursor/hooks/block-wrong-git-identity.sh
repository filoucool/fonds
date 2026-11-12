#!/usr/bin/env bash
# Block agent shell commands that force the wrong GitHub commit identity.
set -euo pipefail

input=$(cat)
command=$(echo "$input" | jq -r '.command // empty')

if [ -z "$command" ]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

if [[ "$command" =~ GIT_AUTHOR_EMAIL=felix@users\.noreply\.github\.com ]] \
  || [[ "$command" =~ GIT_COMMITTER_EMAIL=felix@users\.noreply\.github\.com ]] \
  || [[ "$command" =~ user\.email=felix@users\.noreply\.github\.com ]]; then
  echo '{
    "permission": "deny",
    "user_message": "Blocked: that noreply address maps to github.com/felix, not filoucool. Use 25182703+filoucool@users.noreply.github.com or felix@nexumnet.com, or plain git commit.",
    "agent_message": "Do not override git identity with the legacy felix noreply. See .cursor/rules/git-commit-identity.mdc."
  }'
  exit 0
fi

if [[ "$command" =~ (GIT_AUTHOR_EMAIL|GIT_COMMITTER_EMAIL|user\.email)= ]] \
  && [[ "$command" =~ @users\.noreply\.github\.com ]] \
  && [[ ! "$command" =~ \+filoucool@users\.noreply\.github\.com ]] \
  && [[ ! "$command" =~ dependabot ]]; then
  echo '{
    "permission": "deny",
    "user_message": "Blocked: unscoped @users.noreply.github.com on a git commit command. Use 25182703+filoucool@users.noreply.github.com or commit without overriding identity.",
    "agent_message": "Remove GIT_*_EMAIL / user.email overrides or use the filoucool noreply address."
  }'
  exit 0
fi

echo '{ "permission": "allow" }'
exit 0
