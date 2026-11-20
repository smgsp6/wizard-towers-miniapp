#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077

if [[ $# -gt 1 || ( $# -eq 1 && $1 != --register-webhook ) ]]; then
  printf '用法：bash deploy/install.sh [--register-webhook]\n' >&2
  exit 2
fi
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1 ||
   ! docker compose version >/dev/null 2>&1; then
  printf '请先从 Docker 官方渠道安装 Docker Engine 和 Compose v2，并使用有 Docker 权限的账号。\n' >&2
  exit 1
fi

if [[ -L private || -L private/app.env || -L private/compose.env ]]; then
  printf '私有配置路径不能是符号链接。\n' >&2
  exit 1
fi
mkdir -p private
chmod 700 private
if [[ ! -f private/compose.env ]]; then
  read -r -p '输入已指向 VPS 的域名（例如 play.example.com）：' domain
  if [[ ! $domain =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
    printf '请输入不含 HTTPS、端口或路径的完整域名。\n' >&2
    exit 1
  fi
  printf 'GOMOKU_DOMAIN=%s\n' "$domain" > private/compose.env
fi

compose=(docker compose --env-file private/compose.env)
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

"${compose[@]}" up --build --detach --wait
if [[ ${1-} == --register-webhook ]]; then
  "${compose[@]}" exec -T app node deploy/register-webhook.mjs
fi
domain=$(sed -n 's/^GOMOKU_DOMAIN=//p' private/compose.env)
printf '服务已启动。请验证 https://%s 后，在 BotFather 中将 Mini App URL 设为该地址。\n' "$domain"
