#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077

mode=
register_webhook=false
for argument in "$@"; do
  case "$argument" in
    --cloudflare-tunnel) mode=tunnel ;;
    --register-webhook) register_webhook=true ;;
    *) printf '用法：bash deploy/install.sh [--cloudflare-tunnel] [--register-webhook]\n' >&2; exit 2 ;;
  esac
done
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1 ||
   ! docker compose version >/dev/null 2>&1; then
  printf '请先从 Docker 官方渠道安装 Docker Engine 和 Compose v2，并使用有 Docker 权限的账号。\n' >&2
  exit 1
fi

if [[ -L private || -L private/app.env || -L private/compose.env || -L private/deploy-mode ]]; then
  printf '私有配置路径不能是符号链接。\n' >&2
  exit 1
fi
mkdir -p private
chmod 700 private
if [[ -z $mode && -f private/deploy-mode ]]; then
  read -r mode < private/deploy-mode
fi
mode=${mode:-direct}
if [[ $mode != direct && $mode != tunnel ]]; then
  printf '私有部署模式无效。\n' >&2
  exit 1
fi
if [[ ! -f private/compose.env ]]; then
  read -r -p '输入游戏的公网域名（例如 play.example.com）：' domain
  if [[ ! $domain =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
    printf '请输入不含 HTTPS、端口或路径的完整域名。\n' >&2
    exit 1
  fi
  printf 'GOMOKU_DOMAIN=%s\n' "$domain" > private/compose.env
fi

compose=(docker compose -f compose.yaml --env-file private/compose.env)
if [[ $mode == tunnel ]]; then
  engine_version=$(docker version --format '{{.Server.Version}}')
  if [[ ! $engine_version =~ ^([0-9]+)\. ]] || (( BASH_REMATCH[1] < 28 )); then
    printf 'Tunnel 模式需要 Docker Engine 28 或更新版本，以免回环发布端口被同一局域网访问。\n' >&2
    exit 1
  fi
  running_proxy=$(docker ps --quiet \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME:-qiqu-gomoku}" \
    --filter 'label=com.docker.compose.service=proxy')
  if [[ -n $running_proxy ]]; then
    printf '本项目的公网 Caddy 仍在运行。请先停止本项目的 proxy，再切换 Tunnel。\n' >&2
    exit 1
  fi
  compose+=(-f compose.tunnel.yaml)
fi
if [[ ! -f private/app.env ]]; then
  read -r -p '输入管理员 Telegram 数字 ID：' owner
  if [[ ! $owner =~ ^[1-9][0-9]{0,15}$ ]]; then
    printf '管理员 ID 格式不正确。\n' >&2
    exit 1
  fi
  read -rs -p '输入 BotFather 提供的 Bot Token（不回显）：' token
  printf '\n'
  if [[ ! $token =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
    printf 'Bot Token 格式不正确。\n' >&2
    exit 1
  fi
  if ! command -v openssl >/dev/null; then
    printf '请通过系统官方软件源安装 OpenSSL 后重试。\n' >&2
    exit 1
  fi
  secret=$(openssl rand -hex 32)
  printf 'TELEGRAM_OWNER_ID=%s\nTELEGRAM_BOT_TOKEN=%s\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$owner" "$token" "$secret" > private/app.env
  unset token secret
fi
chmod 600 private/app.env private/compose.env

if [[ $mode == tunnel ]]; then
  "${compose[@]}" up --build --detach --wait app
else
  "${compose[@]}" up --build --detach --wait
fi
printf '%s\n' "$mode" > private/deploy-mode
if $register_webhook; then
  "${compose[@]}" exec -T app node deploy/register-webhook.mjs
fi
domain=$(sed -n 's/^GOMOKU_DOMAIN=//p' private/compose.env)
if [[ $mode == tunnel ]]; then
  printf '游戏服务仅监听 127.0.0.1:18080。请在这台 VPS 的 Cloudflare Tunnel 中把 %s 指向 http://127.0.0.1:18080。\n' "$domain"
fi
printf '服务已启动。请验证 https://%s 后，在 BotFather 中将 Mini App URL 设为该地址。\n' "$domain"
