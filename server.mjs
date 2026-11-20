import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const size = 15;
export function hasFive(board, x, y, side) {
  return [[1,0],[0,1],[1,1],[1,-1]].some(([dx,dy]) => {
    let length = 1;
    for (const direction of [-1,1]) {
      let col = x + dx * direction;
      let row = y + dy * direction;
      while (col >= 0 && col < size && row >= 0 && row < size && board[row * size + col] === side) {
        length++;
        col += dx * direction;
        row += dy * direction;
      }
    }
    return length >= 5;
  });
}

export function makeServer({ token, owner, allowed = [] } = {}) {
  const authorized = new Set(allowed);
  const empty = () => ({ guest: null, board: Array(size * size).fill(0), turn: 1, result: 0, last: null });
  let game = empty();
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/hero.webp', ['hero.webp', 'image/webp']],
  ]);
  return createServer(async (req, res) => {
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
    if (req.url !== '/api/room' || !['GET', 'POST'].includes(req.method)) return send(404, { error: '页面不存在' });
    if (!token || !/^\d+$/.test(owner ?? '')) return send(503, { error: 'Telegram 对局服务尚未配置' });
    const id = telegramID(req.headers['x-telegram-init-data'], token);
    if (!id) return send(401, { error: '请从 Telegram 小程序重新打开大厅' });
    if (id !== owner && !authorized.has(id)) return send(403, { error: '你的账号尚未获得对局授权' });
    if (req.method === 'POST') {
      let action;
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) return send(413, { error: '请求过大' });
        }
        action = JSON.parse(body);
      } catch {
        return send(400, { error: '无效请求' });
      }
      if (action?.type === 'join' && id !== owner) {
        if (game.guest && game.guest !== id) return send(409, { error: '白方已有玩家' });
        game.guest = id;
      } else if (action?.type === 'reset' && id === owner) {
        game = empty();
      } else if (action?.type === 'move') {
        const side = id === owner ? 1 : id === game.guest ? 2 : 0;
        const { x, y } = action;
        if (![x,y].every(n => Number.isInteger(n) && n >= 0 && n < size)) return send(400, { error: '落点超出棋盘' });
        const index = y * size + x;
        if (!game.guest || !side || side !== game.turn || game.result || game.board[index]) {
          return send(409, { error: '当前无法在这里落子' });
        }
        game.board[index] = side;
        game.last = index;
        game.result = hasFive(game.board, x, y, side) ? side : game.board.includes(0) ? 0 : 3;
        game.turn = 3 - side;
      } else {
        return send(400, { error: '无效操作' });
      }
    }
    const { board, turn, result, last } = game;
    const side = id === owner ? 1 : id === game.guest ? 2 : 0;
    return send(200, { board: side ? board : [], turn, result: side ? result : 0, last: side ? last : null, joined: Boolean(game.guest), side });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = makeServer({
    token: process.env.TELEGRAM_BOT_TOKEN,
    owner: process.env.TELEGRAM_OWNER_ID,
    allowed: (process.env.TELEGRAM_ALLOWED_IDS ?? '').split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id)),
  });
  server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1');
}
