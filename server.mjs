import { createServer } from 'node:http';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomStore } from './room-store.mjs';
import { chooseMove, hasFive, size } from './gomoku-ai.mjs';
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
const empty = (ai = false) => ({ joined: false, ai, dueAt: null, board: Array(size * size).fill(0), turn: 1, result: 0, last: null });

function place(game, index, side) {
  game.board[index] = side;
  game.last = index;
  game.result = hasFive(game.board, index % size, Math.floor(index / size), side)
    ? side : game.board.includes(0) ? 0 : 3;
  game.turn = 3 - side;
}

function playAI(game) {
  if (!game.ai || !game.joined || game.result || game.turn !== 1) return;
  const move = chooseMove(game.board);
  if (move !== -1) place(game, move, 1);
}

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
    const deadlines = Object.values(store.state.rooms).map(game => game.dueAt).filter(Number.isSafeInteger);
    if (!deadlines.length) return;
    timer = setTimeout(() => {
      const state = structuredClone(store.state);
      for (const game of Object.values(state.rooms)) {
        if (game.dueAt !== null && game.dueAt <= Date.now()) {
          game.dueAt = null;
          playAI(game);
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
    if (req.url !== '/api/room' || !['GET', 'POST'].includes(req.method)) return send(404, { error: '页面不存在' });
    if (!token || !validID(owner)) return send(503, { error: 'Telegram 对局服务尚未配置' });
    const id = telegramID(req.headers['x-telegram-init-data'], token);
    if (!id) return send(401, { error: '请从 Telegram 小程序重新打开大厅' });
    const admin = id === owner;
    let action = null;
    if (req.method === 'POST') {
      try { action = await readJSON(req, 2048); } catch {}
      if (!action || typeof action.type !== 'string') return send(400, { error: '无效请求' });
    }
    const saved = store.state;
    if (!admin && !saved.allowed.includes(id)) return send(403, { error: '你的账号尚未获得对局授权' });
    const state = action ? structuredClone(saved) : saved;
    let opponent = admin ? state.selected : id;
    if (admin && ['authorize', 'revoke', 'select'].includes(action?.type)) {
      const target = action.id;
      if (!validID(target) || target === owner) return send(400, { error: '请输入有效的好友数字 ID' });
      if (action.type === 'authorize' && !state.allowed.includes(target)) state.allowed.push(target);
      if (action.type === 'revoke') {
        state.allowed = state.allowed.filter(allowedID => allowedID !== target);
        delete state.rooms[target];
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
        game = empty(game.ai);
      } else if (action.type === 'mode' && admin && typeof action.ai === 'boolean') {
        game.ai = action.ai;
      } else if (action.type === 'move') {
        const side = admin ? 1 : 2;
        const { x, y } = action;
        if (![x,y].every(n => Number.isInteger(n) && n >= 0 && n < size)) return send(400, { error: '落点超出棋盘' });
        const index = y * size + x;
        if (!game.joined || side !== game.turn || game.result || game.board[index] || (admin && game.ai)) {
          return send(409, { error: '当前无法在这里落子' });
        }
        place(game, index, side);
      } else {
        return send(400, { error: '无效操作' });
      }
      if (game.ai && game.joined && !game.result && game.turn === 1) {
        game.dueAt ??= Date.now() + randomInt(3000, 10001);
      } else {
        game.dueAt = null;
      }
      state.rooms[opponent] = game;
    }
    if (action) {
      if (!store.commit(state)) return send(503, { error: '暂时无法保存，请重试' });
      schedule();
    }
    const { board, turn, result, last, joined, ai } = state.rooms[opponent] ?? empty();
    const side = admin ? 1 : joined ? 2 : 0;
    return send(200, {
      board, turn, result, last, joined, side,
      ...(admin && { management: { allowed: state.allowed, opponent, ai } }),
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
