#!/usr/bin/env bash
set -euo pipefail
context=$(kubectl config current-context)
[[ "$context" == "kw" ]] || exit 0
owner=$(kubectl --context "$context" -n kryton-operator-system get applications.sync.kuvryn.io kryton-operator --ignore-not-found -o name) || {
  echo "Cannot establish operator ownership; refusing legacy deployment." >&2
  exit 1
}
if [[ -n "$owner" ]]; then
  echo "kw Kryton operator is managed by Kuvryn Sync. Edit deploy/kuvryn-sync and push master." >&2
  exit 1
fi
