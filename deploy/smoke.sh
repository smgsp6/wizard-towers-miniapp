#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
workspace=$(mktemp -d)
project="qiqu-test-$(basename "$workspace" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
compose=(docker compose -p "$project" --project-directory "$workspace" -f "$workspace/compose.yaml" -f "$workspace/smoke.yaml" --env-file "$workspace/private/compose.env")
cleanup() {
  "${compose[@]}" down --volumes --rmi local >/dev/null 2>&1 || true
  rm -rf -- "$workspace"
}
trap cleanup EXIT
cp -r Dockerfile Dockerfile.proxy .dockerignore compose.yaml server.mjs room-store.mjs gomoku-ai.mjs public deploy "$workspace/"
mkdir -m 700 "$workspace/private"
printf 'GOMOKU_DOMAIN=localhost\n' > "$workspace/private/compose.env"
printf 'TELEGRAM_OWNER_ID=101\nTELEGRAM_BOT_TOKEN=synthetic-testing\n' > "$workspace/private/app.env"
printf 'services:\n  proxy:\n    ports: !reset []\n' > "$workspace/smoke.yaml"

if ! "${compose[@]}" up --build --detach --wait; then
  "${compose[@]}" logs --no-color
  exit 1
fi
"${compose[@]}" exec -T app node -e '
  const fs = require("node:fs");
  if (!process.getuid()) process.exit(1);
  fs.writeFileSync("/state/synthetic-check", "ok", { mode: 0o600 });
  fetch("http://127.0.0.1:8080/api/room").then(r => {
    if (r.status !== 401) process.exitCode = 1;
  });
'
"${compose[@]}" restart app
"${compose[@]}" exec -T app node -e '
  if (require("node:fs").readFileSync("/state/synthetic-check", "utf8") !== "ok") process.exit(1);
'
for attempt in {1..15}; do
  if "${compose[@]}" exec -T proxy cat /data/caddy/pki/authorities/local/root.crt |
     "${compose[@]}" exec -T app node -e '
       const ca = require("node:fs").readFileSync(0);
       require("node:https").get({hostname:"proxy", servername:"localhost", headers:{host:"localhost"}, ca}, res => {
         let body = "";
         res.setEncoding("utf8").on("data", chunk => body += chunk);
         res.on("end", () => { if (res.statusCode !== 200 || !body.includes("棋趣大厅")) { console.error("Proxy status:", res.statusCode, body.slice(0, 120)); process.exitCode = 1; } });
       }).on("error", error => { console.error(error.code); process.exitCode = 1; });
     '; then
    printf 'Docker 启动、持久卷和本地 HTTPS 代理验证通过。\n'
    exit 0
  fi
  sleep 1
done
"${compose[@]}" logs --no-color proxy
printf '本地 HTTPS 代理验证失败。\n' >&2
exit 1
