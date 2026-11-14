#!/usr/bin/env bash
# The ear worker: takes teaching-minute jobs from a Vire server and runs each search in a Modal Sandbox.
# usage: sandbox/run-worker.sh https://the-server
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: sandbox/run-worker.sh https://the-server" >&2
  exit 2
fi
export VIRE_SERVER="$1"
export VIRE_REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$VIRE_REPO"

# hsec gives the Modal token and the worker's token only to this process tree. Nothing is echoed or written down.
exec hsec exec --only JUNCTION_MODAL_TOKEN_ID,JUNCTION_MODAL_TOKEN_SECRET,VIRE_WORKER_TOKEN -- sh -c \
  'MODAL_TOKEN_ID="$JUNCTION_MODAL_TOKEN_ID" MODAL_TOKEN_SECRET="$JUNCTION_MODAL_TOKEN_SECRET" exec bun server/ear-worker.ts'
