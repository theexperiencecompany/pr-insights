#!/usr/bin/env bash
# Deploy pr-insights to a remote host over SSH.
#   ./deploy.sh <host> [binary]
# Builds the frontend first (frontend/dist is embedded in the Go binary).
# The GitHub token is taken from GITHUB_TOKEN, falling back to `gh auth token`.
set -euo pipefail

# mise-managed toolchain (go) lives behind the mise shims
export PATH="$HOME/.local/share/mise/shims:$PATH"

HOST="${1:?usage: deploy.sh <host> [binary]}"
BIN="${2:-./pr-insights}"
SRV=pr-insights
REMOTE_DIR=/opt/pr-insights
ENV_FILE=/etc/pr-insights.env

echo "==> building frontend (frontend/dist)"
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build

echo "==> building Go binary (linux/amd64, embeds frontend/dist)"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$BIN" .

if [[ ! -f "$BIN" ]]; then
  echo "binary not found: $BIN (build it first: go build -o pr-insights .)" >&2
  exit 1
fi

TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [[ -z "$TOKEN" ]]; then
  echo "no GitHub token: set GITHUB_TOKEN or run gh auth login" >&2
  exit 1
fi

echo "==> uploading binary to ${HOST}:${REMOTE_DIR}/"
ssh "$HOST" "sudo mkdir -p ${REMOTE_DIR} && sudo chown root:root ${REMOTE_DIR}"
scp -q "$BIN" "${HOST}:/tmp/pr-insights.new"
ssh "$HOST" "sudo mv -f /tmp/pr-insights.new ${REMOTE_DIR}/pr-insights && sudo chmod 755 ${REMOTE_DIR}/pr-insights"

echo "==> writing ${ENV_FILE}"
ssh "$HOST" "printf 'GITHUB_TOKEN=%s\nGITHUB_ORG=theexperiencecompany\nPR_INSIGHTS_ADDR=127.0.0.1:8787\nPR_INSIGHTS_DATA_DIR=/var/lib/pr-insights\nPR_INSIGHTS_SYNC_INTERVAL=6h\nENTIRE_BIN=/usr/local/bin/entire\nENTIRE_HOME=/var/lib/pr-insights/entire-home\nENTIRE_TOKEN_STORE=file\nENTIRE_SYNC_INTERVAL=15m\n' '${TOKEN}' | sudo tee ${ENV_FILE} >/dev/null && sudo chown root:root ${ENV_FILE} && sudo chmod 600 ${ENV_FILE}"

echo "==> installing entire CLI (agent checkpoint analytics)"
ssh "$HOST" "sudo test -x /usr/local/bin/entire || curl -fsSL https://github.com/entireio/cli/releases/latest/download/entire_linux_amd64.tar.gz | sudo tar -xz -C /usr/local/bin entire && sudo chmod 755 /usr/local/bin/entire"
ssh "$HOST" "sudo mkdir -p /var/lib/pr-insights/entire-home && sudo chown prinsights:prinsights /var/lib/pr-insights/entire-home"

echo "==> installing systemd unit"
scp -q systemd/pr-insights.service "${HOST}:/tmp/pr-insights.service"
ssh "$HOST" "sudo mv -f /tmp/pr-insights.service /etc/systemd/system/pr-insights.service && sudo systemctl daemon-reload"

echo "==> creating service user (if needed)"
ssh "$HOST" "sudo id prinsights >/dev/null 2>&1 || sudo useradd --system --no-create-home --home-dir /opt/pr-insights --shell /usr/sbin/nologin prinsights"

echo "==> starting service"
ssh "$HOST" "sudo systemctl enable pr-insights && sudo systemctl restart pr-insights && sleep 2 && sudo systemctl status pr-insights --no-pager | head -8"

echo "==> smoke test"
ssh "$HOST" "curl -sf http://127.0.0.1:8787/healthz && echo '  -> healthz ok'"

if ssh "$HOST" "sudo test -x /usr/local/bin/entire"; then
  echo "==> one-time entire login (required for the /entire page):"
  echo "  ssh ${HOST} \"sudo -u prinsights env HOME=/var/lib/pr-insights/entire-home /usr/local/bin/entire login --device\""
  echo "  (visit the printed URL, enter the code, then restart the service: sudo systemctl restart pr-insights)"
fi

echo "deploy complete"
