#!/bin/sh
# Converge this box to match rootfs/, install the app shipped beside it, restart once.
# Idempotent; runs as root on the box, invoked by deploy.sh from the unpacked bundle.
set -eu
cd "$(dirname "$0")"
app=$(cd ../.. && pwd)

export DEBIAN_FRONTEND=noninteractive
# apt waits for Ubuntu's own apt jobs, which hold its lock for a while after a fresh box first boots.
echo 'DPkg::Lock::Timeout "600";' >/etc/apt/apt.conf.d/90stillwell-lock
if ! command -v curl >/dev/null; then # a minimal image may lack it, and the repositories below need it first
	apt-get update -q
	apt-get install -yq curl
fi
# Grafana's apt repository, for Alloy. The key is fetched once; apt checks every package against it.
if [ ! -f /etc/apt/keyrings/grafana.asc ]; then
	mkdir -p /etc/apt/keyrings
	curl -fsSL https://apt.grafana.com/gpg.key -o /etc/apt/keyrings/grafana.asc
fi
echo 'deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main' >/etc/apt/sources.list.d/grafana.list
# ClickHouse's own apt repository, on its long-term-support releases.
if [ ! -f /usr/share/keyrings/clickhouse-keyring.gpg ]; then
	# Fetched whole before it's written, so a failed download never leaves an empty keyring behind.
	key=$(mktemp)
	curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key -o "$key"
	gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg "$key"
	rm -f "$key"
fi
echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=$(dpkg --print-architecture)] https://packages.clickhouse.com/deb lts main" >/etc/apt/sources.list.d/clickhouse.list
# Refresh the lists and install the packages, getting past a vendor repository that refuses its index.
. ./apt-update.sh
# ClickHouse is installed once, at the release CI tests against, and upgraded by hand, so a deploy never
# changes the database under live data.
if ! command -v clickhouse-server >/dev/null; then
	apt-get install -yq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold 'clickhouse-client=26.8.*' 'clickhouse-server=26.8.*' 'clickhouse-common-static=26.8.*'
fi

# Node: the newest release of the major version .mise.toml names, as CI tests with, from nodejs.org and
# checked against its published checksums. A deploy installs a newer patch release when there is one.
major=$(sed -nE 's/^node *= *"([0-9]+)".*/\1/p' "$app/.mise.toml")
[ -n "$major" ] || { echo 'apply.sh: no node major version in .mise.toml' >&2; exit 1; }
dist="https://nodejs.org/dist/latest-v$major.x"
sums=$(curl -fsSL "$dist/SHASUMS256.txt")
tarball=$(printf '%s\n' "$sums" | awk '$2 ~ /^node-v[0-9.]+-linux-x64\.tar\.xz$/ { print $2 }')
version=${tarball%-linux-x64.tar.xz}
if [ ! -x "/opt/$version/bin/node" ]; then
	tmp=$(mktemp -d)
	curl -fsSL "$dist/$tarball" -o "$tmp/$tarball"
	(cd "$tmp" && printf '%s\n' "$sums" | grep " $tarball\$" | sha256sum -c -)
	mkdir -p "/opt/$version"
	tar xJf "$tmp/$tarball" -C "/opt/$version" --strip-components=1
	rm -rf "$tmp"
fi
ln -sfn "/opt/$version" /opt/node

id stillwell >/dev/null 2>&1 || useradd --system --shell /usr/sbin/nologin stillwell
# ops reads the journal for investigating alerts and changes nothing; its keys are in rootfs/etc/ssh/authorized_keys.d/ops.
id ops >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash ops
usermod -aG systemd-journal ops

# The sshd drop-in is the one file that can lock everyone out of the box, and a bad one
# only bites on the next reboot, so roll it back if it does not validate.
drop=/etc/ssh/sshd_config.d/10-hardening.conf
if [ -f "$drop" ]; then
	cp "$drop" "$drop.bak"
fi
cp -R rootfs/. /
if ! sshd -t; then
	if [ -f "$drop.bak" ]; then
		mv "$drop.bak" "$drop"
	else
		rm -f "$drop"
	fi
	echo 'sshd config invalid: rolled back the drop-in' >&2
	exit 1
fi
rm -f "$drop.bak"
# ops reaches no network at all (ops-egress.nft). The unit loads it at boot, before sshd; here the file is
# loaded directly, since it replaces the table in one step, where a restart of the unit would drop it first.
systemctl daemon-reload
systemctl enable ops-egress.service
nft -f /etc/stillwell/ops-egress.nft
systemctl reload ssh

# Seed only: secrets live on the box, never in the repo.
if [ ! -f /etc/stillwell.env ]; then
	install -m 600 stillwell.env.example /etc/stillwell.env
	echo 'created /etc/stillwell.env from template: fill in USGS_API_KEY and GITHUB_TOKEN' >&2
fi
# ClickHouse's default user, which the poller connects as, gets a password generated once on the box, so a
# shell on the box needs the root-only env file to reach the data, whatever the firewall does.
if ! grep -q '^CLICKHOUSE_PASSWORD=.' /etc/stillwell.env; then
	sed -i '/^CLICKHOUSE_PASSWORD=/d' /etc/stillwell.env
	# On a line of its own, even after a hand edit saved without a final newline.
	[ -z "$(tail -c1 /etc/stillwell.env)" ] || echo >>/etc/stillwell.env
	echo "CLICKHOUSE_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')" >>/etc/stillwell.env
fi
ch_hash=$(sed -n 's/^CLICKHOUSE_PASSWORD=//p' /etc/stillwell.env | tr -d '\n' | sha256sum | cut -d' ' -f1)
# Its own file name: the ClickHouse package writes default-password.xml when it asks for a password.
umask 077
cat >/etc/clickhouse-server/users.d/stillwell-password.xml <<XML
<!-- Written by apply.sh from CLICKHOUSE_PASSWORD in /etc/stillwell.env. -->
<clickhouse>
    <users>
        <default>
            <password remove="1"/>
            <password_sha256_hex>$ch_hash</password_sha256_hex>
        </default>
    </users>
</clickhouse>
XML
umask 022
chown root:clickhouse /etc/clickhouse-server/users.d/stillwell-password.xml
chmod 640 /etc/clickhouse-server/users.d/stillwell-password.xml
if [ ! -f /etc/alloy.env ]; then
	install -m 600 alloy.env.example /etc/alloy.env
	echo 'created /etc/alloy.env from template: fill in the Grafana Cloud credentials to ship metrics' >&2
fi

# The app, its unit and its environment, against the stamp of the ones the poller last restarted with, so a
# deploy that changes none of them, such as a change to docs or to this directory, leaves the poller and its
# schedule running.
app_sum=$({
	(cd "$app" && find package.json package-lock.json .mise.toml src server -path server/deploy -prune -o -type f ! -name '*.md' -print |
		LC_ALL=C sort | xargs md5sum)
	cat /etc/systemd/system/stillwell-ingest.service /etc/stillwell.env
	readlink /opt/node
} | md5sum)
app_stamp=/var/lib/stillwell-app.md5
app_changed=
if [ "$app_sum" != "$(cat "$app_stamp" 2>/dev/null)" ] || [ ! -d /opt/stillwell ]; then
	app_changed=1
	# Installed beside the running one and swapped in just before the restart, so a failed install leaves it as it was;
	# without install scripts, which would run as root, and which no dependency has.
	rm -rf /opt/stillwell.new
	mkdir -p /opt/stillwell.new
	cp -R "$app/package.json" "$app/package-lock.json" "$app/.mise.toml" "$app/src" "$app/server" /opt/stillwell.new/
	(cd /opt/stillwell.new && PATH="/opt/node/bin:$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
fi

systemctl daemon-reload
systemctl restart systemd-journald
systemctl enable clickhouse-server fail2ban stillwell-ingest
# ClickHouse restarts only when its own files differ from the ones it last restarted with, recorded in a
# stamp, so a deploy does not interrupt it for nothing and one that stopped partway is caught up by the next.
ch_sum=$(cat /etc/clickhouse-server/config.d/stillwell.xml /etc/systemd/system/clickhouse-server.service.d/10-stillwell.conf | md5sum)
ch_stamp=/var/lib/clickhouse/stillwell-config.md5
if [ "$ch_sum" != "$(cat "$ch_stamp" 2>/dev/null)" ]; then
	systemctl restart clickhouse-server
	echo "$ch_sum" >"$ch_stamp"
else
	systemctl start clickhouse-server
fi
systemctl reload-or-restart fail2ban

# Alloy runs only once /etc/alloy.env names the Grafana Cloud endpoint; without one it would crash-loop.
alloy=
if grep -q '^GRAFANA_CLOUD_PROM_URL=.' /etc/alloy.env; then
	alloy=1
	# With the unit's environment, so the config is checked as Alloy will run it.
	# shellcheck source=/dev/null
	# A config this Alloy release rejects leaves it as it was rather than block the app's deploy.
	if (set -a && . /etc/alloy.env && alloy validate /etc/alloy/config.alloy); then
		systemctl enable alloy
		systemctl restart alloy
	else
		echo 'alloy config invalid: left Alloy as it was' >&2
		alloy=
	fi
else
	systemctl disable --now alloy
	echo 'alloy off: fill in /etc/alloy.env to ship metrics' >&2
fi

# The poller waits for ClickHouse, which can take a few seconds to listen after a restart.
curl -fsS --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:8123/ping >/dev/null
# ClickHouse reloads users.d on its own; this waits until the password is in force before the poller starts.
# The password goes in the environment, never on a command line any user can read.
CLICKHOUSE_PASSWORD=$(sed -n 's/^CLICKHOUSE_PASSWORD=//p' /etc/stillwell.env) || exit 1
export CLICKHOUSE_PASSWORD
ready=
for _ in $(seq 1 30); do
	if clickhouse-client -q 'SELECT 1' >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 1
done
[ -n "$ready" ] || { echo 'apply.sh: ClickHouse refuses the password in /etc/stillwell.env' >&2; exit 1; }
if [ -n "$app_changed" ]; then
	rm -rf /opt/stillwell.old
	if [ -d /opt/stillwell ]; then
		mv /opt/stillwell /opt/stillwell.old
	fi
	mv /opt/stillwell.new /opt/stillwell
	systemctl restart stillwell-ingest
	rm -rf /opt/stillwell.old
	echo "$app_sum" >"$app_stamp"
else
	systemctl start stillwell-ingest
	echo 'stillwell-ingest unchanged: left running' >&2
fi
# Older Node releases, once nothing runs from them.
for old in /opt/node-v*; do
	[ "$old" = "/opt/$version" ] || rm -rf "$old"
done
sleep 5
systemctl is-active clickhouse-server
systemctl is-active stillwell-ingest
if [ -n "$alloy" ]; then
	systemctl is-active alloy
fi
