#!/bin/sh
# Apply the alert rules and their email contact point to Grafana Cloud. Rerun after any change to rules.yaml;
# each step converges, and rules removed from it are deleted. The sync is scoped to the stillwell namespace,
# so it leaves other folders' rules alone.
# Usage: GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<service account token> ALERT_EMAIL=<address> server/deploy/grafana/push.sh
# Needs curl, jq, and mimirtool. GRAFANA_PROM_UID overrides the Prometheus data source the rules query.
set -eu
cd "$(dirname "$0")"
: "${GRAFANA_URL:?}" "${GRAFANA_TOKEN:?}" "${ALERT_EMAIL:?}"
url=${GRAFANA_URL%/}
prom=${GRAFANA_PROM_UID:-grafanacloud-prom}
# Grafana explains a rejected request in the response body, so a failure prints it.
api() {
	out=$(curl -sS --fail-with-body -H "Authorization: Bearer $GRAFANA_TOKEN" -H 'Content-Type: application/json' "$@") ||
		{ printf '%s\n' "$out" >&2; return 1; }
	printf '%s\n' "$out"
}

contact=$(jq -n --arg to "$ALERT_EMAIL" '{uid: "stillwell-email", name: "stillwell email", type: "email", settings: {addresses: $to}}')
if api "$url/api/v1/provisioning/contact-points" | jq -e 'any(.[]; .uid == "stillwell-email")' >/dev/null; then
	api -X PUT "$url/api/v1/provisioning/contact-points/stillwell-email" -d "$contact" >/dev/null
else
	api -X POST "$url/api/v1/provisioning/contact-points" -d "$contact" >/dev/null
fi

MIMIR_ADDRESS=$url/api/convert/ MIMIR_AUTH_TOKEN=$GRAFANA_TOKEN MIMIR_TENANT_ID=1 \
	mimirtool rules sync rules.yaml --namespaces stillwell --concurrency 1 \
	--extra-headers "X-Grafana-Alerting-Datasource-UID=$prom" \
	--extra-headers 'X-Grafana-Alerting-Notification-Settings={"receiver":"stillwell email"}'
