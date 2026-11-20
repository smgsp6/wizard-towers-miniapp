# 游戏大厅

Telegram Mini App 游戏大厅。通过「棋类游戏 → 五子棋」选择好友对弈或人机练习。自由规则，15 × 15，黑先白后，连续五枚或更多获胜。每位获授权好友拥有一份独立棋局。

## 运行和验证

使用 Node.js 24，无 npm 依赖。

```sh
node --test
node server.mjs
```

浏览器可打开本地 `http://127.0.0.1:8080` 查看界面。对局要求签名有效且一小时内的 Telegram 登录数据，超时后重新打开小程序。

## Telegram 和私有配置

正式运行需要获授权的 HTTPS 服务，在 BotFather 中配置 Mini App URL，并通过官方 Bot API 设置 webhook 到 `/api/telegram`。Webhook 的 secret_token 与服务端 `TELEGRAM_WEBHOOK_SECRET` 相同，Bot 在私聊响应 `/id` 和 `/start`，只回报发送方本人的数字 ID。

服务端配置 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_OWNER_ID`，可用逗号分隔的 `TELEGRAM_ALLOWED_IDS` 初始化好友名单。管理员在小程序内授权、移除和切换好友对局，开局前选择执黑或执白，并切换手动与本机 AI。AI 在服务端用自写的棋型评估和 Alpha–Beta 搜索选点，识别活三、活四和双威胁。每手最多搜索 600 个节点，逐步加深至 4 层，并在强制应手时延伸搜索。AI 每步随机等待 3 至 10 秒，手动接管立即取消待落子。普通玩家只收到自己的棋局和黑白席位信息。大厅另有人机练习，获授权用户可选黑或白，练习局独立保存。

正式使用时将 `GOMOKU_STATE_FILE` 指向公开仓库之外、仅服务账户可访问的现有私有目录中的文件。单服务实例通过临时文件和原子替换保存，每个状态文件只由一个进程写入。首次存档后以文件内名单为准。备份前停服务，将文件复制到私有备份位置。恢复时停止服务，恢复兼容备份文件和相同的 Owner 配置，再启动。无存档路径时为内存模式，重启会清盘。默认绑定回环地址，通过 `HOST` 和 `PORT` 可配合反向代理。真实密钥、授权名单和对局文件禁止提交。

## VPS 一键安装

准备一台已通过官方渠道安装 Docker Engine 和 Docker Compose v2 的 Linux VPS，域名的 DNS 记录指向 VPS，并确认 TCP 80 和 443 可从公网访问且未被其他服务占用。使用 GitHub 的 **Code → Download ZIP** 下载本仓库并解压。进入解压后的目录，检查 `deploy/install.sh` 后运行：

```sh
bash deploy/install.sh
```

脚本会询问域名、管理员数字 ID 和 Bot Token。Token 输入不回显，保存在权限为 600 的 `private/app.env`，应用容器以非 root 用户运行。安装会启动 Caddy 自动办理 HTTPS。在浏览器确认 HTTPS 可访问后，在 BotFather 设置 Mini App URL。如使用机器人私聊查询 ID，可显式注册该 Bot 的 webhook（会替换该 Bot 的旧 webhook）：

```sh
bash deploy/install.sh --register-webhook
```

用 `docker compose --env-file private/compose.env stop` 停止服务。重要更新前先停服，私下备份 `private/` 并用 Docker 官方的卷备份流程备份 `qiqu-gomoku_room-state`。证书卷也应作为私有数据保护。回滚时使用原发布源码及相应存档备份执行安装脚本。保留原安装目录的 `private/` 配置，切勿运行带 `--volumes` 的清理命令来做常规更新。

容器依赖为 Docker Official Images 的 Node.js 24.22.1（MIT，Debian slim）与 Caddy 2.11.9（Apache-2.0，Alpine），在 Dockerfile 和 Compose 中锁定官方镜像清单摘要。应用无 npm 依赖。容器验证运行 `bash deploy/smoke.sh`，仅用合成账号、临时卷和本地 TLS。

好友局的 AI 代下会检查对手最多三手的 VCF（包含成五）。拟落子会留下已验证的胜线，或短暂冲四却没有找到本方取胜线时，管理员会看到带编号的变化，并可接管或认输。提示按显示的前提成立，搜索有上限。独立的人机练习继续对弈。

V 模式由管理员在指定好友局开启，可选定两个空位并确认。服务器按选定顺序落同色子，不要求当前轮到管理员。第一枚已结束对局时不会落第二枚。执行后取消待执行的 AI 落子。

镜像审查来源：[Node.js 24.22.1 发布说明](https://nodejs.org/en/blog/release/v24.22.1)、[Caddy 2.11.9 发布](https://github.com/caddyserver/caddy/releases/tag/v2.11.9)、[Caddy 安全公告](https://github.com/caddyserver/caddy/security/advisories)、[Docker Official Images](https://github.com/docker-library/official-images)。已按上游公告选择修复后的 Caddy 版本。当前开发环境无法访问 Debian 和 Alpine 的完整安全数据库，基础镜像传递依赖的完整漏洞扫描尚待完成。

管理员界面由单独的服务端端点提供。该端点验证 Telegram 签名和 Owner ID。普通玩家收到的页面没有管理面板、AI 代下、VCF 提示、V 模式或清盘控制。

## 游戏目录与界面预览

大厅先选分类，再选游戏和玩法。「棋类游戏」收录五子棋和跳棋。「桌游」收录原创双人同屏地产桌游「街区大亨」。

- 跳棋好友对弈复用 Telegram 授权，并独立保存每位好友的局面。人机对战在本机进行。选中棋子后，双方共用的棋盘会标出合法落点。管理员专用的推荐路线由服务端计算，只提供给管理员的好友对弈界面。
- 街区大亨有 40 格、十个街区，支持买卖地契、三层立体楼房、街区租金加成、事件、破产和 40 回合结算。商圈推广、租金护盾和临时稽查是双方可见的一次性能力。同屏局暂存于页面，刷新会重新开始。
- 音乐由浏览器实时合成，默认静音，点击开启后播放，页面进入后台时暂停。
