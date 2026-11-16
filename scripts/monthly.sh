#!/usr/bin/env bash
# One source's part of the Monthly workflow, which the workflow's jobs and the server's job queue
# (docs/plans/jobs.md) both run, so a source refreshes the same way wherever its writers are.
#
#   scripts/monthly.sh lists <source> [--full] [--accept-epochs] [--accept-withheld]
#   scripts/monthly.sh refresh|analyze|requalify-recent|bsh-predictions <source> [...]
#   scripts/monthly.sh refetch <source>
#
# `lists` runs the list job's steps in order, each even when one before it failed, as the workflow's
# `!cancelled()` steps do, and fails if any did: `refresh` (the station list, without publishing, which
# Monthly's or Compact daily's publish does), `analyze`, `requalify-recent` with `--full` (a full refresh,
# not one of named sources), and `bsh-predictions` for BSH. STARTED, the job's start in epoch seconds,
# bounds requalify-recent's budget, now when unset. The store and its credentials come from the
# environment, as for scripts/ingest.ts. Dates are GNU date's, as on the runners and the server.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
ingest() { node "$root/scripts/ingest.ts" "$@"; }
step=${1:?usage: monthly.sh <step> <source> [options]}
SOURCE=${2:?usage: monthly.sh <step> <source> [options]}
shift 2
STARTED=${STARTED:-$(date +%s)}
# Requalify's and analysis's stations at once; the server's job queue sets it to fit a job's memory.
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
# over the whole year, not the recent window's 7 days that compaction folds in. Compaction folds last month's
# final days again for a few nights after this, with the window's flags, so each month is judged whole by the
# next month's run, December's by February's. Only a full refresh runs it. As a step of the list job, not a job
# of its own, it puts no job in the source's lane to cancel one waiting there, such as a compaction. It takes
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

# BSH publishes next year's predictions from about August. Each refresh fetches this year's for every gauge, so
# a gauge added in the year, or a month whose run failed, is filled by the next, and from August to December next
# year's too. A year not yet published writes nothing, and one unchanged rewrites no file. Nothing else fetches
# BSH, whose metadata is neither hourly nor finalizes.
bsh_predictions() {
  local year end
  year=$(date -u +%Y)
  end=$((year + 1))
  if [ "$(date -u +%m)" -ge 08 ]; then end=$((year + 2)); fi
  ingest backfill bsh all "$year" "$end"
}

# CO-OPS verifies a month a month or two after it ends, so most stations start at last month or this one, a
# request a month at one a second; one never verified is fetched from the cutoff on, 36 requests or more. USGS
# approves months to years later, a year a request at one every 3.7 seconds, too many for one run across 11,000
# stations, so each month takes a twelfth of them, at most about 1,200 stations and up to three years each, about
# 3.7 hours at most, and each station comes round once a year; the current year is left to compaction. RWS and
# USACE ask a year a request. Some USACE offices screen nothing, so their values stay preliminary for good;
# --skip-unscreened leaves out a station with a year of record and no value its source screened, but for
# January's run. REFMAR's partner gauges often have only raw values, so it skips them the same way. California
# DWR's files run days to months behind and nothing else fetches them, so every active DWR station is read again
# from January of last year to today, finished years included.
refetch() {
  local year month which from status=0
  year=$(date -u +%Y)
  month=$(date -u +%m)
  which=preliminary
  from=$((year - 3))
  case "$SOURCE" in
    usgs) set -- "$year" --shard "$((10#$month))/12" ;;
    dwr) which=all from=$((year - 1)) && set -- "$(date -u +%F)" --refetch ;;
    # Every January takes them all, so a station whose office began screening since, or a new epoch's, is read
    # again and can rejoin.
    usace | refmar)
      if [ "$month" != 01 ]; then set -- "$year-$month-01" --skip-unscreened; else set -- "$year-$month-01"; fi
      ;;
    # JMA isn't hourly, so this is also what brings its new values: every open station from two months back,
    # whose final file is out by now, to this month's provisional one.
    jma)
      # A station that fails doesn't keep the rest from their refetch.
      ingest backfill jma all "$(date -u -d "$year-$month-01 -2 months" +%F)" "$(date -u -d "$year-$month-01 +1 month" +%F)" || status=1
      set -- "$year-$month-01"
      ;;
    # LINZ isn't hourly either: its daily files appear 6 to 12 days late, so this is what brings its new values.
    # Every open station is read again from two months back to the end of this month, since the preliminary run
    # below stops at the year of a station's last value and skips one with no preliminary value, which leaves out
    # the first days of a new year and a new gauge. That run then reads each station from its earliest
    # preliminary value, which brings in the year's file that replaces a year's daily files.
    linz)
      ingest backfill linz all "$(date -u -d "$year-$month-01 -2 months" +%F)" "$(date -u -d "$year-$month-01 +1 month" +%F)" || status=1
      set -- "$(date -u -d "$year-$month-01 +1 month" +%F)"
      ;;
    # CMEMS isn't hourly either: its latest window holds about the last month, and its history copy reaches about
    # two months back, a month at a time, so every gauge is read again from six months back, closing the gap
    # between the two and finalizing what the history copy has replaced. Stopped gauges too, since the history
    # copy reaches a gauge's last months after it leaves the latest window; one that stopped earlier asks for
    # nothing past its last day.
    cmems) which=all from=$(date -u -d "$year-$month-01 -6 months" +%F) && set -- "$(date -u -d "$year-$month-01 +1 month" +%F)" --with-inactive ;;
    # BOM isn't hourly: its archives are rebuilt about monthly, weeks behind, and a finished year's again in the
    # new year's first weeks, and nothing else brings its new values, so every active gauge is read again from the
    # year before last to this one, as BODC's are, past the year each gauge's last value is in, which the
    # default's cap would stop at.
    bom) which=all from=$((year - 2)) && set -- "$((year + 1))" --refetch ;;
    # BODC's months arrive late and in batches, sometimes two years behind, and it fills gaps and reflags months
    # it has published; nothing else fetches them, so every station's last three years are read again, finished
    # ones included.
    bodc) which=all from=$((year - 2)) && set -- "$((year + 1))" --refetch ;;
    # CRMS's only source is CPRA's weekly export of the whole record, read once a run and months behind, and CPRA
    # re-adjusts recent months after field visits, so every station's last three years are read again, as BODC's
    # are. Every station is named, since `all` skips inactive ones and CIMS retires a gauge before its last
    # months reach the export; they cost only reads of the export the run downloads anyway.
    crms)
      which=$(STILLWELL_ROOT=$root node --input-type=module -e 'const { readStationList } = await import(`${process.env.STILLWELL_ROOT}/src/store/parquet.ts`); const list = await readStationList(`${process.env.STILLWELL_STORE}/stations/crms.parquet`); if (!list?.length) throw new Error("no CRMS list in the store"); console.log(list.map((s) => s.source_id).join(","))') || return 1
      from=$((year - 2)) && set -- "$((year + 1))" --refetch
      ;;
    *) set -- "$year-$month-01" ;;
  esac
  ingest backfill "$SOURCE" "$which" "$from" "$@" || status=1
  return "$status"
}

case "$step" in
  lists)
    status=0
    refresh "$@" || status=1
    analyze || status=1
    if [[ " $* " == *" --full "* ]]; then requalify_recent || status=1; fi
    if [ "$SOURCE" = bsh ]; then bsh_predictions || status=1; fi
    exit "$status"
    ;;
  refresh) refresh "$@" ;;
  analyze) analyze ;;
  requalify-recent) requalify_recent ;;
  bsh-predictions) bsh_predictions ;;
  refetch) refetch ;;
  *)
    echo "usage: monthly.sh lists|refresh|analyze|requalify-recent|bsh-predictions|refetch <source> [options]" >&2
    exit 2
    ;;
esac
