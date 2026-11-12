# The Stillwell server

The box that runs `stillwell-ingest`, the realtime poller ([docs/plans/realtime.md](../../docs/plans/realtime.md)), with ClickHouse beside it. It reads the public store over HTTPS and writes nothing to R2, so the box holds nothing that can't be rebuilt but the `polls` history: a new one fills ClickHouse from `recent/` on its first pass and polls from there.

## What's here

- [`deploy.sh`](deploy.sh) is the whole deploy: it bundles `package.json`, the lockfile, `.mise.toml`, `src/` and `server/` from `HEAD`, sends them over ssh, and runs `apply.sh` on the box. The same command sets up a fresh box and updates the live one: `server/deploy/deploy.sh root@<ip>`. CI runs it on every push to `main` once the repository variable `DEPLOY_HOST` is set (`.github/workflows/ci.yml`, the `deploy` job).
- [`apply.sh`](apply.sh) converges the box:
  - installs ClickHouse 26.8, the long-term-support release CI tests against, once, and Alloy, fail2ban, nftables and unattended-upgrades;
  - installs the newest Node of the major version `.mise.toml` names, from nodejs.org, checked against its published checksums, into `/opt/node`;
  - creates the `stillwell` and `ops` users;
  - copies `rootfs/`, rolling back the sshd drop-in if it doesn't validate;
  - installs the app into `/opt/stillwell` with `npm ci --omit=dev`, beside the running one, and swaps it in just before restarting the poller;
  - restarts ClickHouse only when its own config changed, and the poller only when the app, its unit, its environment or Node changed, so a deploy of docs or of this directory leaves the poller's schedule running;
  - records the commit it deployed in `/var/lib/stillwell-deployed` when that commit is on `main`, and CI skips a commit the box already has, so a run that finishes late never puts older code back. A deploy of a commit not on `main`, such as a branch, clears the record, so the next push to `main` deploys.

  It also generates a password for ClickHouse's `default` user once, into `/etc/stillwell.env` as `CLICKHOUSE_PASSWORD`, which the poller sends, and writes its hash to `/etc/clickhouse-server/users.d/stillwell-password.xml`. It's idempotent and safe to rerun. It seeds `/etc/stillwell.env` and `/etc/alloy.env` from the templates only when they're missing, and never overwrites them. [`apt-update.sh`](apt-update.sh), which it runs for the packages, gets past a vendor repository that refuses its index with a 402 or a 5xx on a box that already has every package.

- [`stillwell.env.example`](stillwell.env.example) lists what `/etc/stillwell.env` holds, and [`alloy.env.example`](alloy.env.example) the Grafana Cloud credentials in `/etc/alloy.env`. The real files stay on the box; secrets never enter the repo.
- `rootfs/` holds the units and config, copied over `/`:
  - `stillwell-ingest.service` runs `node server/ingest.ts` as `stillwell`, with a 2.5 GB memory cap over the poller and its passes. Three passes run at a time, since each is a process of its own holding up to about 600 MB, and a pass the kernel stops for memory fails alone.
  - ClickHouse listens on loopback only, capped at 4 GB by [its config](rootfs/etc/clickhouse-server/config.d/stillwell.xml) and held to a hard 4.5 GB ceiling and half the CPU weight by [a systemd drop-in](rootfs/etc/systemd/system/clickhouse-server.service.d/10-stillwell.conf), so the kernel stops ClickHouse before the poller.
  - Alloy ships the host's unit restarts and a few ClickHouse series to Grafana Cloud once `/etc/alloy.env` is filled in.
  - sshd is key-only, with fail2ban (3 tries in 10 minutes bans for an hour), and the journal is capped at 500 MB.

## The box

A Hetzner CPX31 (4 vCPU, 8 GB, 160 GB) on Ubuntu 24.04, at a different site from aiscast's box. Root logs in with the maintainers' keys and the CI deploy key. The `ops` user is an unprivileged shell for reading the journal (`journalctl -u stillwell-ingest`) and `systemctl status` while investigating an alert. It has no network: [ops-egress.nft](rootfs/etc/stillwell/ops-egress.nft), loaded before sshd, refuses it any connection, ClickHouse's on loopback included, which its password also guards. It can't read `/etc/stillwell.env` and has no sudo, but it can read the whole journal and anything world-readable. sshd reads its keys only from [rootfs](rootfs/etc/ssh/authorized_keys.d/ops), never from its home.

## Setting up a box

1. Create the server in Hetzner's console or API, Ubuntu 24.04, with the maintainers' ssh keys and the CI deploy key's public half.
2. Deploy to it: `server/deploy/deploy.sh root@<ip>`. The first run creates `/etc/stillwell.env` and `/etc/alloy.env` from the templates.
3. Fill in `/etc/stillwell.env`: `USGS_API_KEY`, a key of the server's own, and `GITHUB_TOKEN`, a fine-grained token for openwatersio/stillwell with Actions read and write. Fill in `/etc/alloy.env` to ship metrics. Then run `deploy.sh` again.
4. For deploys from CI: set the repository variable `DEPLOY_HOST` to the box's address, and in the `server` environment the secrets `DEPLOY_SSH_KEY` (the deploy key's private half) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <ip>`).

A replacement box is the same steps. Nothing on the old one needs copying: ClickHouse fills from `recent/` on each source's first pass.

## Operating

- `journalctl -u stillwell-ingest -f` shows each pass's summary, as the hourly workflow's log does.
- `(set -a && . /etc/stillwell.env && clickhouse-client -q "SELECT source, started, ok, stations, updated, values, length(failed), length(stale) FROM stillwell.polls ORDER BY started DESC LIMIT 20")` shows the last passes. `clickhouse-client` reads the password from `CLICKHOUSE_PASSWORD`, which keeps it off the command line other users can read.
- ClickHouse is upgraded by hand, so a deploy never changes the database under live data: move CI's image and the version `apply.sh` installs to the new release together, then `apt-get install` the three `clickhouse-*` packages at that version and `systemctl restart clickhouse-server`.
- `apply.sh` copies `rootfs/` over `/` and never deletes, so a file removed or renamed in `rootfs/` stays on the box until it's removed there by hand.
- To roll back, revert the commit on `main`. CI skips a rerun of an older run, since the box already has its commit; `deploy.sh` run by hand deploys whatever is checked out.
