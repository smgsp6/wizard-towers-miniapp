# 棋趣大厅

Telegram Mini App 私人五子棋大厅。自由规则，15 × 15，黑先白后，连续五枚或更多获胜。每位获授权好友拥有一份独立棋局。

## 运行和验证

使用 Node.js 24，无 npm 依赖。

```sh
node --test
node server.mjs
```

浏览器可打开本地 `http://127.0.0.1:8080` 查看界面。对局要求签名有效且一小时内的 Telegram 登录数据，超时后重新打开小程序。

## Telegram 和私有配置

正式运行需要获授权的 HTTPS 服务，在 BotFather 中配置 Mini App URL，并通过官方 Bot API 设置 webhook 到 `/api/telegram`。Webhook 的 secret_token 与服务端 `TELEGRAM_WEBHOOK_SECRET` 相同，Bot 在私聊响应 `/id` 和 `/start`，只回报发送方本人的数字 ID。

服务端配置 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_OWNER_ID`，可用逗号分隔的 `TELEGRAM_ALLOWED_IDS` 初始化好友名单。管理员在小程序内授权、移除和切换好友对局，控制黑方是手动还是本机 AI。AI 在服务端用自写的棋型评估和 Alpha–Beta 搜索选点，识别活三、活四和双威胁。每手最多搜索 600 个节点，逐步加深至 4 层，并在强制应手时延伸搜索。AI 每步随机等待 3 至 10 秒，手动接管立即取消待落子。普通玩家只收到自己的棋局和黑白席位信息。

正式使用时将 `GOMOKU_STATE_FILE` 指向公开仓库之外、仅服务账户可访问的现有私有目录中的文件。单服务实例通过临时文件和原子替换保存，每个状态文件只由一个进程写入。首次存档后以文件内名单为准。备份前停服务，将文件复制到私有备份位置。恢复时停止服务，恢复兼容备份文件和相同的 Owner 配置，再启动。无存档路径时为内存模式，重启会清盘。默认绑定回环地址，通过 `HOST` 和 `PORT` 可配合反向代理。真实密钥、授权名单和对局文件禁止提交。
