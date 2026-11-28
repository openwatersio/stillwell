#!/usr/bin/env bash
# One source's part of the Monthly workflow, which the workflow's jobs run.
#
#   scripts/monthly.sh lists <source> [--full] [--accept-epochs] [--accept-withheld]
#   scripts/monthly.sh refresh|analyze|requalify-recent|list-backfills|fit <source> [...]
#   scripts/monthly.sh refetch <source>
#
# `lists` runs the list job's steps in order, each even when one before it failed, as the workflow's
# `!cancelled()` steps do, and fails if any did: `refresh` (the station list, without publishing, which
# Monthly's or Compact daily's publish does), `analyze`, `requalify-recent` with `--full` (a full refresh,
# not one of named sources), `list-backfills`, the source's own backfills after its list, and `fit`, with `--full`. STARTED, the job's start in epoch seconds,
# bounds requalify-recent's and fit's budgets, now when unset. The store and its credentials come from the
# environment, as for scripts/ingest.ts. Dates are GNU date's, as on the runners.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
ingest() { node "$root/scripts/ingest.ts" "$@"; }
step=${1:?usage: monthly.sh <step> <source> [options]}
SOURCE=${2:?usage: monthly.sh <step> <source> [options]}
shift 2
STARTED=${STARTED:-$(date +%s)}
# Requalify's and analysis's stations at once.
concurrency=${STILLWELL_CONCURRENCY:-8}

refresh() {
  local accept=()
  for flag in "$@"; do
    case "$flag" in --accept-epochs | --accept-withheld) accept+=("$flag") ;; esac
  done
  ingest stations "$SOURCE" --no-publish "${accept[@]}"
}

# The stations that are due judged from their levels in the store (src/store/analysis.ts), after the list so
# new stations are judged too, and in the list job so it keeps the source's lane, since a verdict that changes
# a station's QC requalifies its stored years. It runs on the list the store keeps when the refresh fails. A
# run stopped partway keeps what it judged, and leaves the rest pending for the next.
analyze() {
  ingest analyze "$SOURCE" --requalify --concurrency "$concurrency"
}

# Every station's years that hold the last two months, requalified with the current rules and errata and judged
# over the whole year, not the poller's 7 days that compaction folds in. Compaction folds last month's
# final days again for a few nights after this, with the window's flags, so each month is judged whole by the
# next month's run, December's by February's. Only a full refresh runs it. As a step of the list job, not a job
# of its own, it puts no job in the source's lane to wait ahead of one waiting there, such as a compaction. It takes
# only stations with a year file in range, and starts them for at most 90 minutes, and none once the job has
# run 5 hours, so the job ends within its time limit; USGS's, the most, took about 25 minutes in a local
# measurement. The stations it didn't finish, and every one when no time is left, are saved in the store with
# their years, and the next run starts with them, over those years too. A run killed partway saves nothing new,
# and the next starts again from the last saved list.
requalify_recent() {
  local left budget month from to
  left=$(((STARTED + 300 * 60 - $(date +%s)) / 60))
  budget=$((left < 90 ? left : 90))
  # With no time left it still runs, to save every station for the next.
  if [ "$budget" -lt 0 ]; then budget=0; fi
  month=$(date -u +%Y-%m-01)
  from=$(date -u -d "$month -2 months" +%Y)
  to=$(date -u -d "$month -1 month" +%Y)
  ingest requalify "$SOURCE" all "$from" "$((to + 1))" --budget "$budget" --concurrency "$concurrency"
}

# The source's own backfills for this job, from its adapter's `schedule`, whose comment says why (scripts/schedule.ts):
# for `lists` none by default, and for `refetch` each station from its earliest preliminary value, from January
# REFETCH_YEARS back (src/sources/schedule.ts), to this month. A run that fails doesn't keep the rest from theirs.
backfills() {
  local plan args status=0
  plan=$(node "$root/scripts/schedule.ts" "$1" "$SOURCE") || return 1
  while IFS=$'\t' read -r -a args; do
    if [ "${#args[@]}" -gt 0 ]; then ingest backfill "$SOURCE" "${args[@]}" || status=1; fi
  done <<<"$plan"
  return "$status"
}

# Harmonic constants for the source's stations whose fit is due (src/fit/store.ts), last in the list job, so
# they read the levels and verdicts the steps before it left, and in the source's lane, since a fit reads year
# files a backfill or compaction would rewrite. A fit is a minute or more of computation a station, so it starts
# stations for at most 2 hours, and none once the job has run 5 and a half, the largest tides first. The rest
# stay due for the next run: in most months only stations whose levels changed are due, and when a source's
# final year moves on or the candidate list changes, all of them are, and a large source takes several runs
# to catch up. Only a source
# with a station that has constants is fitted (`--only-fitted`), so a source's first fit is a run by hand from
# the Ingest workflow, which a maintainer makes once the source's fits can be trusted. Only a full refresh runs it.
fit() {
  local left budget
  left=$(((STARTED + 330 * 60 - $(date +%s)) / 60))
  budget=$((left < 120 ? left : 120))
  # With no time left it still runs, to say how many stations are due.
  if [ "$budget" -lt 0 ]; then budget=0; fi
  ingest fit "$SOURCE" --budget "$budget" --only-fitted
}

case "$step" in
  lists)
    status=0
    refresh "$@" || status=1
    analyze || status=1
    if [[ " $* " == *" --full "* ]]; then requalify_recent || status=1; fi
    backfills lists || status=1
    if [[ " $* " == *" --full "* ]]; then fit || status=1; fi
    exit "$status"
    ;;
  refresh) refresh "$@" ;;
  analyze) analyze ;;
  requalify-recent) requalify_recent ;;
  list-backfills) backfills lists ;;
  fit) fit ;;
  refetch) backfills refetch ;;
  *)
    echo "usage: monthly.sh lists|refresh|analyze|requalify-recent|list-backfills|fit|refetch <source> [options]" >&2
    exit 2
    ;;
esac
