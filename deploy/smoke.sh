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
cp -r Dockerfile Dockerfile.proxy .dockerignore compose.yaml compose.tunnel.yaml estate-admin.html estate-room.mjs checkers-admin.html checkers-room.mjs admin-panel.html server.mjs room-store.mjs gomoku-ai.mjs public deploy "$workspace/"
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
  if (!process.getuid() || process.version !== "v24.22.3") process.exit(1);
  fs.writeFileSync("/state/synthetic-check", "ok", { mode: 0o600 });
  fetch("http://127.0.0.1:8080/api/room").then(r => {
    if (r.status !== 401) process.exitCode = 1;
  });
'
"${compose[@]}" restart app
"${compose[@]}" exec -T app node -e '
  if (require("node:fs").readFileSync("/state/synthetic-check", "utf8") !== "ok") process.exit(1);
'
direct_ok=false
for attempt in {1..15}; do
  if "${compose[@]}" exec -T proxy cat /data/caddy/pki/authorities/local/root.crt |
     "${compose[@]}" exec -T app node -e '
       const ca = require("node:fs").readFileSync(0);
       require("node:https").get({hostname:"proxy", servername:"localhost", headers:{host:"localhost"}, ca}, res => {
         let body = "";
         res.setEncoding("utf8").on("data", chunk => body += chunk);
         res.on("end", () => {
           if (res.statusCode !== 200 || !body.includes("游戏大厅") || !res.headers["content-security-policy"] ||
               res.headers["permissions-policy"] !== "camera=(), microphone=(), geolocation=()") {
             console.error("Unexpected HTTPS response:", res.statusCode); process.exitCode = 1;
           }
         });
       }).on("error", error => { console.error(error.code); process.exitCode = 1; });
     '; then
    printf 'Docker 启动、持久卷和本地 HTTPS 代理验证通过。\n'
    direct_ok=true
    break
  fi
  sleep 1
done
if ! $direct_ok; then
  "${compose[@]}" logs --no-color proxy
  printf '本地 HTTPS 代理验证失败。\n' >&2
  exit 1
fi

if (cd "$workspace" && COMPOSE_PROJECT_NAME="$project" bash deploy/install.sh --cloudflare-tunnel </dev/null); then
  printf '切换 Tunnel 时应拒绝仍在运行的公网代理。\n' >&2
  exit 1
fi
"${compose[@]}" stop proxy
(cd "$workspace" && COMPOSE_PROJECT_NAME="$project" bash deploy/install.sh --cloudflare-tunnel </dev/null) > "$workspace/installer-output"
grep -Fq '正在构建并启动游戏服务' "$workspace/installer-output"
grep -Fq '游戏服务仅监听 127.0.0.1:18080' "$workspace/installer-output"
if grep -Eq 'naming to docker|Container |\#[0-9]+ \[' "$workspace/installer-output"; then
  printf '安装过程不应显示容器引擎的英文构建输出。\n' >&2
  exit 1
fi
test "$(cat "$workspace/private/deploy-mode")" = tunnel
tunnel=(docker compose -p "$project" -f "$workspace/compose.yaml" -f "$workspace/compose.tunnel.yaml" --env-file "$workspace/private/compose.env")
test "$("${tunnel[@]}" port app 8080)" = '127.0.0.1:18080'
test -z "$("${compose[@]}" ps --status running --quiet proxy)"
curl --noproxy 127.0.0.1 --fail --silent --show-error http://127.0.0.1:18080/ -o "$workspace/tunnel-response.html"
grep -Fq '游戏大厅' "$workspace/tunnel-response.html"
"${tunnel[@]}" exec -T app node -e 'if (require("node:fs").readFileSync("/state/synthetic-check", "utf8") !== "ok") process.exit(1)'
(cd "$workspace" && COMPOSE_PROJECT_NAME="$project" bash deploy/install.sh </dev/null)
test -z "$("${compose[@]}" ps --status running --quiet proxy)"
printf 'Cloudflare Tunnel 本机源站、模式保留与持久卷验证通过。\n'
