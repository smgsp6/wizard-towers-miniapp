import { createServer } from 'node:http';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomStore } from './room-store.mjs';
import { checkersRoom } from './checkers-room.mjs';
import { estateRoom } from './estate-room.mjs';
import { chooseMove, findVCF, hasFive, size } from './gomoku-ai.mjs';
export { hasFive } from './gomoku-ai.mjs';

export function telegramID(raw, token, now = Date.now()) {
  if (!token || typeof raw !== 'string' || !raw || raw.length > 8192) return null;
  const data = new URLSearchParams(raw);
  if (new Set(data.keys()).size !== data.size) return null;
  const hash = data.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash ?? '')) return null;
  data.delete('hash');
  data.sort();
  const check = [...data].map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', key).update(check).digest();
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), expected)) return null;
  const issued = Number(data.get('auth_date')) * 1000;
  if (!Number.isSafeInteger(issued) || issued > now + 30_000 || now - issued > 3_600_000) return null;
  try {
    const { id } = JSON.parse(data.get('user'));
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  } catch {
    return null;
  }
}

const validID = id => typeof id === 'string' && /^[1-9][0-9]{0,15}$/.test(id) && Number.isSafeInteger(Number(id));
const empty = (ai = false, aiSide = 1) => ({ joined: false, ai, aiSide, dueAt: null, board: Array(size * size).fill(0), turn: 1, result: 0, last: null });

function place(game, index, side) {
  game.board[index] = side;
  game.last = index;
  game.result = hasFive(game.board, index % size, Math.floor(index / size), side)
    ? side : game.board.includes(0) ? 0 : 3;
  game.turn = 3 - side;
}

function playAI(game, alertOwner) {
  const side = game.aiSide ?? 1;
  if (!game.ai || !game.joined || game.result || game.turn !== side) return;
  const move = chooseMove(game.board, side);
  if (move === -1) return;
  if (alertOwner && !hasFive(game.board, move % size, Math.floor(move / size), side)) {
    const preview = game.board.slice();
    preview[move] = side;
    const line = findVCF(preview, 3 - side);
    if (line) {
      game.ai = false;
      game.analysis = { afterMove: true, line: [{ index: move, side }, ...line] };
      return;
    }
    const forcesReply = preview.some((stone, index) =>
      !stone && hasFive(preview, index % size, Math.floor(index / size), side));
    if (forcesReply && findVCF(game.board, side)?.[0].index !== move) {
      const latent = findVCF(game.board, 3 - side);
      if (latent) {
        game.ai = false;
        game.analysis = { afterMove: false, line: latent };
        return;
      }
    }
  }
  place(game, move, side);
}

function queueAI(game) {
  if (game.ai && game.joined && !game.result && game.turn === (game.aiSide ?? 1)) {
    game.dueAt ??= Date.now() + randomInt(3000, 10001);
  } else {
    game.dueAt = null;
  }
}

function movePlayer(game, action, side) {
  const { x, y } = action;
  if (![x,y].every(n => Number.isInteger(n) && n >= 0 && n < size)) return 400;
  const index = y * size + x;
  if (!game.joined || side !== game.turn || game.result || game.board[index] || (game.ai && side === (game.aiSide ?? 1))) return 409;
  place(game, index, side);
  return 200;
}

const games = state => [...Object.values(state.rooms), ...Object.values(state.practice ?? {})];

async function readJSON(req, limit) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) return null;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function makeServer({ token, owner, allowed = [], stateFile, webhookSecret } = {}) {
  const store = roomStore(stateFile, owner, allowed.filter(validID));
  let timer;
  function schedule(retry = 0) {
    clearTimeout(timer);
    const deadlines = games(store.state).map(game => game.dueAt).filter(Number.isSafeInteger);
    if (!deadlines.length) return;
    timer = setTimeout(() => {
      const state = structuredClone(store.state);
      const practiceGames = new Set(Object.values(state.practice ?? {}));
      for (const game of games(state)) {
        if (game.dueAt !== null && game.dueAt <= Date.now()) {
          game.dueAt = null;
          playAI(game, !practiceGames.has(game));
        }
      }
      schedule(store.commit(state) ? 0 : 1000);
    }, Math.max(retry, Math.min(...deadlines) - Date.now()));
    timer.unref();
  }
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/estate.mjs', ['estate.mjs', 'text/javascript; charset=utf-8']],
    ['/music.mjs', ['music.mjs', 'text/javascript; charset=utf-8']],
    ['/checkers.mjs', ['checkers.mjs', 'text/javascript; charset=utf-8']],
    ['/checkers-rules.mjs', ['checkers-rules.mjs', 'text/javascript; charset=utf-8']],
    ['/estate-map.webp', ['estate-map.webp', 'image/webp']],
    ['/hero.webp', ['hero.webp', 'image/webp']],
  ]);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.method === 'GET' && files.has(req.url)) {
      const [name, type] = files.get(req.url);
      try {
        const body = await readFile(new URL(`./public/${name}`, import.meta.url));
        res.writeHead(200, {'Content-Type': type}).end(body);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }
    const send = (status, value) => res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    }).end(JSON.stringify(value));
    if (req.url === '/api/telegram' && req.method === 'POST') {
      const secret = Buffer.from(webhookSecret ?? '');
      const supplied = Buffer.from(req.headers['x-telegram-bot-api-secret-token'] ?? '');
      if (!secret.length || supplied.length !== secret.length || !timingSafeEqual(secret, supplied)) return send(403, {});
      try {
        const { message } = (await readJSON(req, 32768)) ?? {};
        const id = message?.from?.id;
        if (message?.chat?.type !== 'private' || message.chat.id !== id || !validID(String(id))) return send(200, {});
        if (!/^\/(id|start)(?:@\w+)?(?:\s|$)/i.test(message.text ?? '')) return send(200, {});
        return send(200, { method: 'sendMessage', chat_id: id, text: `你的 Telegram 数字 ID 是 ${id}。请私下发给管理员申请授权。` });
      } catch {
        return send(400, {});
      }
    }
    const practice = req.url === '/api/practice';
    const checkers = req.url === '/api/checkers';
    const estate = req.url === '/api/estate';
    const panels = { '/api/admin-panel': 'admin-panel.html', '/api/checkers-admin': 'checkers-admin.html', '/api/estate-admin': 'estate-admin.html' };
    const panel = req.method === 'GET' && Object.hasOwn(panels, req.url) ? panels[req.url] : null;
    if ((!panel && !practice && !checkers && !estate && req.url !== '/api/room') || !['GET', 'POST'].includes(req.method)) return send(404, { error: '页面不存在' });
    if (!token || !validID(owner)) return send(503, { error: 'Telegram 对局服务尚未配置' });
    const id = telegramID(req.headers['x-telegram-init-data'], token);
    if (!id) return send(401, { error: '请从 Telegram 小程序重新打开大厅' });
    const admin = id === owner;
    if (panel) {
      if (!admin) return send(403, { error: '没有访问权限' });
      try {
        const html = await readFile(new URL(panel, import.meta.url));
        return res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        }).end(html);
      } catch {
        return send(500, { error: '无法加载管理界面' });
      }
    }
    let action = null;
    if (req.method === 'POST') {
      try { action = await readJSON(req, 2048); } catch {}
      if (!action || typeof action.type !== 'string') return send(400, { error: '无效请求' });
    }
    const saved = store.state;
    if (!admin && !saved.allowed.includes(id)) return send(403, { error: '你的账号尚未获得对局授权' });
    if (checkers) return send(...checkersRoom(store, id, owner, action));
    if (estate) return send(...estateRoom(store, id, owner, action));
    const state = action ? structuredClone(saved) : saved;
    if (practice) {
      const existing = state.practice?.[id];
      let game = existing ?? empty();
      if (action) {
        if (action.type === 'start' && [1, 2].includes(action.side)) {
          game = { ...empty(true, 3 - action.side), joined: true };
        } else if (action.type === 'move' && existing) {
          const code = movePlayer(game, action, 3 - game.aiSide);
          if (code !== 200) return send(code, { error: '当前无法在这里落子' });
        } else {
          return send(400, { error: '无效操作' });
        }
        queueAI(game);
        (state.practice ??= {})[id] = game;
        if (!store.commit(state)) return send(503, { error: '暂时无法保存，请重试' });
        schedule();
      }
      const { board, turn, result, last, joined, aiSide } = game;
      return send(200, { board, turn, result, last, joined, side: joined ? 3 - aiSide : 0 });
    }
    let opponent = admin ? state.selected : id;
    if (admin && ['authorize', 'revoke', 'select'].includes(action?.type)) {
      const target = action.id;
      if (!validID(target) || target === owner) return send(400, { error: '请输入有效的好友数字 ID' });
      if (action.type === 'authorize' && !state.allowed.includes(target)) state.allowed.push(target);
      if (action.type === 'revoke') {
        state.allowed = state.allowed.filter(allowedID => allowedID !== target);
        delete state.rooms[target];
        if (state.practice) delete state.practice[target];
        if (state.checkers) delete state.checkers[target];
        if (state.estate) delete state.estate[target];
        if (state.estateOpponent === target) state.estateOpponent = null;
        if (state.checkersOpponent === target) state.checkersOpponent = null;
        if (state.selected === target) state.selected = null;
      }
      if (action.type === 'select') {
        if (!state.allowed.includes(target)) return send(400, { error: '请先授权该好友' });
        state.selected = target;
      }
      opponent = state.selected;
    } else if (action) {
      if (!opponent || (admin && action.opponent !== opponent)) return send(409, { error: '对局已切换，请重新操作' });
      let game = state.rooms[opponent] ?? empty();
      if (action.type === 'join' && !admin) {
        game.joined = true;
      } else if (action.type === 'reset' && admin) {
        game = empty(game.ai, game.aiSide ?? 1);
      } else if (action.type === 'color' && admin && [1, 2].includes(action.side)) {
        if (game.last !== null) return send(409, { error: '本局已开局，请重开后换色' });
        game.aiSide = action.side;
        game.dueAt = null;
      } else if (action.type === 'mode' && admin && typeof action.ai === 'boolean') {
        game.ai = action.ai;
        if (game.ai) delete game.analysis;
      } else if (action.type === 'v-mode' && admin && typeof action.enabled === 'boolean') {
        game.vMode = action.enabled;
      } else if (action.type === 'v-move' && admin && game.vMode && game.joined && !game.result) {
        const cells = action.cells;
        if (!Array.isArray(cells) || cells.length !== 2 || cells[0] === cells[1] ||
            cells.some(index => !Number.isInteger(index) || index < 0 || index >= game.board.length || game.board[index])) {
          return send(400, { error: '请选择两个不同的空位' });
        }
        game.ai = false;
        delete game.analysis;
        for (const index of cells) {
          place(game, index, game.aiSide ?? 1);
          if (game.result) break;
        }
      } else if (action.type === 'resign' && admin && game.joined && !game.result) {
        game.result = 3 - (game.aiSide ?? 1);
        delete game.analysis;
      } else if (action.type === 'move') {
        const ownerSide = game.aiSide ?? 1;
        const code = movePlayer(game, action, admin ? ownerSide : 3 - ownerSide);
        if (code !== 200) return send(code, { error: '当前无法在这里落子' });
        delete game.analysis;
      } else {
        return send(400, { error: '无效操作' });
      }
      queueAI(game);
      state.rooms[opponent] = game;
    }
    if (action) {
      if (!store.commit(state)) return send(503, { error: '暂时无法保存，请重试' });
      schedule();
    }
    const { board, turn, result, last, joined, ai, aiSide = 1, analysis, vMode = false } = state.rooms[opponent] ?? empty();
    const side = admin ? aiSide : joined ? 3 - aiSide : 0;
    return send(200, {
      board, turn, result, last, joined, side,
      ...(admin && { management: { allowed: state.allowed, opponent, ai, analysis, vMode } }),
    });
  });
  server.on('close', () => clearTimeout(timer));
  schedule();
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = makeServer({
    token: process.env.TELEGRAM_BOT_TOKEN,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    stateFile: process.env.GOMOKU_STATE_FILE,
    owner: process.env.TELEGRAM_OWNER_ID,
    allowed: (process.env.TELEGRAM_ALLOWED_IDS ?? '').split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id)),
  });
  server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1');
}
