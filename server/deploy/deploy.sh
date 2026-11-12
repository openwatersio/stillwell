#!/bin/sh
# Deploy HEAD to the box: send the app and this directory over ssh and run apply.sh there.
#   server/deploy/deploy.sh root@<host>
# The same on a fresh Ubuntu box and the live one; CI runs it on every push to main once DEPLOY_HOST is set.
set -eu
host=${1:?usage: deploy.sh root@host}
cd "$(dirname "$0")/../.."
# The box records the commit it runs when that commit is on main, which CI checks before deploying
# (.github/workflows/ci.yml); a deploy of any other commit clears it, so the next push to main deploys.
git fetch -q origin main
if git merge-base --is-ancestor HEAD origin/main; then
	stamp="echo $(git rev-parse HEAD) >/var/lib/stillwell-deployed"
else
	stamp="rm -f /var/lib/stillwell-deployed"
fi
# Straight from git, so a Mac's tar never adds its ._ files to what lands in /etc.
git archive --format=tar.gz HEAD package.json package-lock.json .mise.toml src server |
	ssh -o ServerAliveInterval=30 "$host" "rm -rf stillwell-deploy && mkdir stillwell-deploy && tar xzf - -C stillwell-deploy && sh stillwell-deploy/server/deploy/apply.sh && $stamp"
