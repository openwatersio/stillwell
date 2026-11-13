# The Stillwell server

The box that runs `stillwell-ingest`, the realtime poller ([docs/plans/realtime.md](../../docs/plans/realtime.md)), with ClickHouse beside it. It reads the public store over HTTPS and writes nothing to R2, so the box holds nothing that can't be rebuilt but the `polls` history: a new one fills ClickHouse from `recent/` on its first pass and polls from there.

## What's here

- [`deploy.sh`](deploy.sh) is the whole deploy: it bundles `package.json`, the lockfile, `.mise.toml`, `src/` and `server/` from `HEAD`, sends them over ssh, and runs `apply.sh` on the box. The same command sets up a fresh box and updates the live one: `server/deploy/deploy.sh root@<ip>`. CI runs it on every push to `main` once the repository variable `DEPLOY_HOST` is set (`.github/workflows/ci.yml`, the `deploy` job). It runs one deploy at a time on the box, each in a directory of its own, and records the commit it deployed in `/var/lib/stillwell-deployed` when that commit is on `main`. CI skips a commit the box already has, so a CI run that finishes late never puts older code back; a deploy by hand at the same time can still race one from CI. A deploy of a commit not on `main`, such as a branch, clears the record, so the next push to `main` deploys.
- [`apply.sh`](apply.sh) converges the box:
  - installs ClickHouse 26.8, the long-term-support release CI tests against, once, and Alloy, fail2ban, nftables and unattended-upgrades;
  - installs the newest Node of the major version `.mise.toml` names, from nodejs.org, checked against its published checksums, into `/opt/node`;
  - creates the `stillwell` and `ops` users;
  - copies `rootfs/`, rolling back the sshd drop-in if it doesn't validate;
  - installs the app into `/opt/stillwell` with `npm ci --omit=dev`, beside the running one, and swaps it in just before restarting the poller;
  - restarts ClickHouse only when its own config changed, and the poller only when the app, its unit, its environment or Node changed, so a deploy of docs or of this directory leaves the poller's schedule running;

  It also generates a password for ClickHouse's `default` user once, into `/etc/stillwell.env` as `CLICKHOUSE_PASSWORD`, which the poller sends, and writes its hash to `/etc/clickhouse-server/users.d/stillwell-password.xml`. It's idempotent and safe to rerun. It seeds `/etc/stillwell.env` and `/etc/alloy.env` from the templates only when they're missing, and never overwrites them. [`apt-update.sh`](apt-update.sh), which it runs for the packages, gets past a vendor repository that refuses its index with a 402 or a 5xx on a box that already has every package.

- [`stillwell.env.example`](stillwell.env.example) lists what `/etc/stillwell.env` holds, and [`alloy.env.example`](alloy.env.example) the Grafana Cloud credentials in `/etc/alloy.env`. The real files stay on the box; secrets never enter the repo.
- [`grafana/`](grafana/) holds the alert rules, which [`grafana/push.sh`](grafana/push.sh) applies to Grafana Cloud (see [Alerts](#alerts)).
- `rootfs/` holds the units and config, copied over `/`:
  - `stillwell-ingest.service` runs `node server/ingest.ts` as `stillwell`, with a 1.8 GB memory cap over the poller and its passes. Two passes run at a time, since each is a process of its own holding up to about 800 MB, and a pass the kernel stops for memory fails alone.
  - ClickHouse listens on loopback only, capped at 1.2 GB by [its config](rootfs/etc/clickhouse-server/config.d/stillwell.xml) and held to a hard 1.5 GB ceiling and half the CPU weight by [a systemd drop-in](rootfs/etc/systemd/system/clickhouse-server.service.d/10-stillwell.conf), so ClickHouse can't take the poller's memory or more than half the CPU under contention.
  - Alloy ships the host's CPU, memory, disk and network, its unit restarts, the poller's pass metrics and a few ClickHouse series to Grafana Cloud once `/etc/alloy.env` is filled in.
  - sshd is key-only, with fail2ban (3 tries in 10 minutes bans for an hour), and the journal is capped at 500 MB.

## The box

`stillwell-1`, a Hetzner CX23 (2 vCPU, 4 GB, 40 GB) in Helsinki on Ubuntu 26.04. That's enough for the poller and the 8 days ClickHouse holds in step 1; resize it to 16 GB, such as a CX43, and raise ClickHouse's and the poller's limits with it, before the history moves in. Root logs in with the maintainers' keys and the CI deploy key. The `ops` user is an unprivileged shell for reading the journal (`journalctl -u stillwell-ingest`) and `systemctl status` while investigating an alert. It has no network: [ops-egress.nft](rootfs/etc/stillwell/ops-egress.nft), loaded before sshd, refuses it any connection, ClickHouse's on loopback included, which its password also guards. It can't read `/etc/stillwell.env` and has no sudo, but it can read the whole journal and anything world-readable. sshd reads its keys only from [rootfs](rootfs/etc/ssh/authorized_keys.d/ops), never from its home.

## Setting up a box

1. Create the server in Hetzner's console or API, Ubuntu 26.04, with the maintainers' ssh keys and the CI deploy key's public half.
2. Deploy to it: `server/deploy/deploy.sh root@<ip>`. The first run creates `/etc/stillwell.env` and `/etc/alloy.env` from the templates.
3. Fill in `/etc/stillwell.env`: `USGS_API_KEY`, a key of the server's own, and `GITHUB_TOKEN`, a fine-grained token for openwatersio/stillwell with Actions read and write. Fill in `/etc/alloy.env` to ship metrics. Then run `deploy.sh` again.
4. For deploys from CI: set the repository variable `DEPLOY_HOST` to the box's address, and in the `server` environment the secrets `DEPLOY_SSH_KEY` (the deploy key's private half) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <ip>`).
5. Once metrics reach Grafana Cloud, apply the alerts with [`grafana/push.sh`](grafana/push.sh) ([Alerts](#alerts)).

A replacement box is the same steps. Nothing on the old one needs copying: ClickHouse fills from `recent/` on each source's first pass.

## Alerts

The poller writes each source's pass metrics to `/var/lib/stillwell/metrics/stillwell.prom` after every pass: when its last pass ended, when its last successful pass ended, its unsuccessful passes, its shortest interval, and the stale stations and failures its last successful pass reported. Alloy's textfile collector ships them. The alert rules are [`grafana/rules.yaml`](grafana/rules.yaml), in Prometheus rule format:

- `StillwellSourceStale`: a source that has stored no new values for three of its shortest interval, or two hours at least. A pass succeeds when it runs to the end, unblocked, and stores new values for some station, or finds nothing to poll, as a new source does until its first list; a source whose short-interval stations go quiet still succeeds on its hourly ones, and a pass can take 50 minutes and wait for a slot. The poller keeps each source's last success and interval across restarts, and a source with none yet counts from when the poller started, so neither a deploy nor a crash loop resets the alert. The alert's success is stricter than `polls.ok`, which says only that the pass ran and some station answered.
- `StillwellMetricsMissing`: no pass metrics reach Grafana for 30 minutes, because Alloy or the box is down. The metrics file outlives the poller, so a stopped poller shows as stale sources instead.
- `StillwellServiceCrashed`: systemd restarted the poller, Alloy or ClickHouse after it exited on its own.

[`grafana/push.sh`](grafana/push.sh) imports the rules as Grafana-managed rules in the `stillwell` folder, routes them to a `stillwell email` contact point, and deletes rules that left the file. Run it once the box ships metrics, since `StillwellMetricsMissing` fires until then, and again after changing the rules. Grafana Cloud emails only members of its organization, so `ALERT_EMAIL` must belong to one. It needs `curl`, `jq`, `mimirtool`, and a service account token with the Admin role:

```sh
GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<token> ALERT_EMAIL=<address> server/deploy/grafana/push.sh
```

`grep -v '^namespace:' server/deploy/grafana/rules.yaml | promtool check rules` checks the rules locally.

## Operating

- `journalctl -u stillwell-ingest -f` shows each pass's summary, as the hourly workflow's log does.
- `(set -a && . /etc/stillwell.env && clickhouse-client -q "SELECT source, started, ok, stations, updated, values, length(failed), length(stale) FROM stillwell.polls ORDER BY started DESC LIMIT 20")` shows the last passes. `clickhouse-client` reads the password from `CLICKHOUSE_PASSWORD`, which keeps it off the command line other users can read.
- ClickHouse is upgraded by hand, so a deploy never changes the database under live data: move CI's image and the version `apply.sh` installs to the new release together, then `apt-get install` the three `clickhouse-*` packages at that version and `systemctl restart clickhouse-server`.
- `apply.sh` copies `rootfs/` over `/` and never deletes, so a file removed or renamed in `rootfs/` stays on the box until it's removed there by hand.
- To roll back, revert the commit on `main`. CI skips a rerun of an older run, since the box already has its commit; `deploy.sh` run by hand deploys whatever is checked out.
