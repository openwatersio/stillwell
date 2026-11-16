#!/usr/bin/env bash
# Fail when main's src/sources/server.json lists the source, whose writers then run only on the server's job
# queue (docs/plans/jobs.md). A workflow runs this before writing a source, since a run queued or re-run from
# an older commit reads that commit's list, which may not have the source yet.
#
#   scripts/server-owns.sh <source>
#
# Run from a checkout of the repository, with `origin` reachable.
set -euo pipefail

source=${1:?usage: server-owns.sh <source>}
# Shallow only where the checkout already is, as in Actions: a shallow fetch makes a full clone shallow.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch -q --depth=1 origin main
else
  git fetch -q origin main
fi
# A main without the file has no source on the server; any other failure to read it stops the write.
if git cat-file -e FETCH_HEAD:src/sources/server.json 2>/dev/null; then
  list=$(git show FETCH_HEAD:src/sources/server.json)
else
  list='{}'
fi
# jq exits 1 for false and 0 for true; anything else is an unreadable list, which fails closed.
status=0
jq -e --arg s "$source" 'if type == "object" then has($s) else error("not an object") end' <<<"$list" >/dev/null || status=$?
case $status in
  0)
    echo "::error::$source is in server.json, so the server's job queue writes it: queue its work on the box with stillwell-jobs enqueue (docs/plans/jobs.md)"
    exit 1
    ;;
  1) ;;
  *)
    echo "::error::main's src/sources/server.json can't be read, so no source is written until it can"
    exit 1
    ;;
esac
