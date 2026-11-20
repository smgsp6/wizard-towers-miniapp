# 棋趣大厅

面向 Telegram Mini App 的中文游戏大厅。首发游戏为自由规则五子棋，15 × 15，黑先白后，连续五枚或更多获胜。

## 本地运行

使用 Node.js 24，项目不需要安装 npm 依赖。

```sh
node --test
node server.mjs
```

访问 `http://127.0.0.1:8080` 查看大厅和棋盘。服务端没有 Telegram 配置时，棋局保持锁定。

## Telegram 配置

正式运行需要 HTTPS Mini App URL，并在 BotFather 中将该 URL 配置为机器人的 Mini App。由部署环境提供 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_OWNER_ID`，以及逗号分隔的 `TELEGRAM_ALLOWED_IDS`。请使用数字 ID，仅通过部署环境配置，不写入仓库。默认绑定回环地址，可通过 `HOST` 与 `PORT` 配合反向代理。

首版为单房间。Owner 固定执黑，第一位获授权且主动入席的账号执白；其他获授权账号无法读取棋局棋子。Owner 可重开并释放白方席位。授权列表随服务进程启动读取，调整配置后需重启服务；局面存于内存，重启会清盘。接口仅接受签名有效且一小时内的 Telegram 登录数据，超时后需重新打开 Mini App。
