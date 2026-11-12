#!/usr/bin/env bash
# Open an issue when a source's job fails in two runs on main in a row, and close
# it once the source's job succeeds again. One open issue per workflow and
# source, found by its title, so failures after the second add nothing.
#
#   scripts/alert.sh <job> [--single]
#
# Run from a workflow's alert job after its matrix, with `job` the matrix
# job's name (`recent` or `compact`) and GH_TOKEN allowed to read Actions and
# write issues. With `--single`, `job` is a job that isn't a matrix, such as
# `publish`, which counts as a source of its own name. Without it, a job of
# that bare name is the matrix skipped before it expanded, so it isn't one.
set -euo pipefail

job=$1
single=${2:-}
repo=$GITHUB_REPOSITORY
run_url="$GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID"
run=$(gh api "repos/$repo/actions/runs/$GITHUB_RUN_ID" --jq '"\(.workflow_id) \(.created_at)"')
read -r workflow created <<<"$run"

# One "<source> <result>" line per matrix job in a run: success, none for a
# job cancelled or skipped before its first step, such as one cancelled while
# it waited on its group, or failure for any other, a timeout included.
conclusions() {
  gh api "repos/$repo/actions/runs/$1/jobs?per_page=100" --jq \
    ".jobs[] | select(if \"$single\" == \"\" then .name | startswith(\"$job (\") else .name == \"$job\" end) | (.name | ltrimstr(\"$job (\") | rtrimstr(\")\")) + \" \" + (if .conclusion == \"success\" then \"success\" elif (.conclusion == \"cancelled\" or .conclusion == \"skipped\") and (.steps | length) == 0 then \"none\" else \"failure\" end)"
}

current=$(conclusions "$GITHUB_RUN_ID")
# With no matrix jobs, the gate couldn't pick the workflow's sources
# (scripts/sources.ts), so nothing ran for any source: one issue for the
# workflow, closed by the next run that has its jobs again.
stuck="$GITHUB_WORKFLOW can't pick its sources"
stuck_open=$(gh issue list --repo "$repo" --state open --limit 200 --json number,title \
  --jq "map(select(.title == \"$stuck\"))[0].number // empty")
if [ -z "$current" ]; then
  echo "No \`$job (<source>)\` jobs in this run, so its gate couldn't pick the sources, or the matrix job was renamed" >&2
  [ -n "$stuck_open" ] || gh issue create --repo "$repo" --title "$stuck" --body "[This run]($run_url) had no \`$job\` jobs, so nothing ran for any source. Its \`gate\` job picks the sources with \`scripts/sources.ts\`; its log says why that failed. This issue closes on its own when a run has the jobs again."
  exit 1
fi
[ -z "$stuck_open" ] || gh issue close "$stuck_open" --repo "$repo" --comment "This run had its jobs again: [run]($run_url)."
# Runs on main before this one, dispatched or scheduled, newest first, until
# each source has one whose job started: up to 100 runs, for a source whose
# jobs keep waiting behind a long backfill. A backup that skipped is one of
# them, so that's between 2 and 4 days of hourly runs, or 50 to 100 nights.
# A skipped backup's jobs count as none. Assigned first so a failed listing
# fails the job.
runs=$(gh api "repos/$repo/actions/workflows/$workflow/runs?branch=main&status=completed&per_page=100" \
  --jq ".workflow_runs[] | select(.created_at < \"$created\") | .id")
earlier=""
for id in $runs; do
  earlier+="$(conclusions "$id")"$'\n'
  unknown=$(cut -d' ' -f1 <<<"$current" | while read -r s; do
    grep -qE "^$s (success|failure)$" <<<"$earlier" || echo "$s"
  done)
  [ -n "$unknown" ] || break
done

while read -r source conclusion; do
  [ -n "$source" ] || continue
  title="$GITHUB_WORKFLOW is failing for $source"
  open=$(gh issue list --repo "$repo" --state open --limit 200 --json number,title \
    --jq "map(select(.title == \"$title\"))[0].number // empty")
  last=$(grep -m1 -E "^$source (success|failure)$" <<<"$earlier" | cut -d' ' -f2 || true)
  echo "$source: $conclusion, before that ${last:-unknown}, open issue ${open:-none}"
  if [ "$conclusion" = failure ] && [ "$last" = failure ] && [ -z "$open" ]; then
    gh issue create --repo "$repo" --title "$title" --body "The \`$job\` job for \`$source\` failed in [this run]($run_url) and in its last run before that. This issue closes on its own when the job next succeeds."
  elif [ "$conclusion" = success ] && [ -n "$open" ]; then
    gh issue close "$open" --repo "$repo" --comment "Succeeded again in [this run]($run_url)."
  fi
done <<<"$current"
