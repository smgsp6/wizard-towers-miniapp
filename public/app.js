const telegram = window.Telegram?.WebApp;
const lobby = document.querySelector('#lobby');
const room = document.querySelector('#room');
const board = document.querySelector('#board');
const status = document.querySelector('#status');
const join = document.querySelector('#join');
const reset = document.querySelector('#reset');
const management = document.querySelector('#management');
const opponent = document.querySelector('#opponent');
const toggleAI = document.querySelector('#toggle-ai');
const revoke = document.querySelector('#revoke');
const authorize = document.querySelector('#authorize');
const friend = document.querySelector('#friend-id');
const size = 15;
let current = null;
let pending = false;

function applyInsets() {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    const inset = Math.max(0, telegram?.safeAreaInset?.[edge] || 0, telegram?.contentSafeAreaInset?.[edge] || 0);
    document.documentElement.style.setProperty(`--tg-${edge}`, `${inset}px`);
  }
}
applyInsets();
telegram?.onEvent('safeAreaChanged', applyInsets);
telegram?.onEvent('contentSafeAreaChanged', applyInsets);
telegram?.ready();

const cells = Array.from({ length: size * size }, (_, index) => {
  const button = document.createElement('button');
  button.className = 'cell';
  button.type = 'button';
  button.onclick = () => request({ type: 'move', x: index % size, y: Math.floor(index / size) });
  board.append(button);
  return button;
});

function render(error = '') {
  const playable = current?.joined && current.side === current.turn && !current.result && !current.management?.ai && !pending;
  for (const [index, cell] of cells.entries()) {
    const stone = current?.board[index] ?? 0;
    cell.dataset.stone = stone;
    cell.dataset.last = String(current?.last === index);
    cell.disabled = !playable || Boolean(stone);
    const label = `第 ${Math.floor(index / size) + 1} 行，第 ${index % size + 1} 列`;
    cell.setAttribute('aria-label', stone ? `${label}，${stone === 1 ? '黑子' : '白子'}` : label);
  }
  const admin = current?.management;
  management.hidden = !admin;
  if (admin) {
    if (opponent.dataset.allowed !== admin.allowed.join(',')) {
      opponent.dataset.allowed = admin.allowed.join(',');
      opponent.replaceChildren(new Option('选择已授权好友', ''), ...admin.allowed.map(id => new Option(id, id)));
    }
    opponent.value = admin.opponent ?? '';
    toggleAI.hidden = revoke.hidden = !admin.opponent;
    toggleAI.textContent = admin.ai ? '手动接管' : '启用 AI 代下';
    opponent.disabled = toggleAI.disabled = revoke.disabled = pending;
  }
  join.hidden = !current || current.side !== 0 || current.joined;
  reset.hidden = current?.side !== 1 || !current.joined;
  join.disabled = reset.disabled = pending;
  let message = '正在连接对局…';
  if (current) {
    const { result, joined, side, turn } = current;
    if (admin && !admin.opponent) message = '请在管理员工具中选择对手';
    else if (side === 0) message = joined ? '白方已有玩家' : '点击入席，执白对弈';
    else if (!joined) message = '等待获授权的好友入席';
    else if (result) message = ['','黑方获胜','白方获胜','和棋'][result];
    else if (admin?.ai && turn === 1) message = 'AI 正在思考';
    else message = side === turn ? '轮到你落子' : '等待对方落子';
  }
  const next = error || message;
  if (status.textContent !== next) status.textContent = next;
}

async function request(action) {
  if (pending || room.hidden) return;
  const initData = telegram?.initData;
  if (!initData) {
    render('请从 Telegram 小程序打开，才能加入对局。');
    return;
  }
  if (action && current?.management) action = { ...action, opponent: current.management.opponent };
  pending = true;
  if (action) render();
  let error = '';
  try {
    const response = await fetch('/api/room', {
      method: action ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': initData, ...(action && { 'Content-Type': 'application/json' }) },
      body: action ? JSON.stringify(action) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (response.ok) current = data;
    else {
      if (response.status !== 409) current = null;
      error = data.error;
    }
  } catch {
    current = null;
    error = '连接中断，正在等待重连。';
  } finally {
    pending = false;
    render(error);
  }
}

authorize.onsubmit = event => {
  event.preventDefault();
  request({ type: 'authorize', id: friend.value.trim() });
};
opponent.onchange = () => {
  if (opponent.value) request({ type: 'select', id: opponent.value });
};
toggleAI.onclick = () => request({ type: 'mode', ai: !current.management.ai });
revoke.onclick = () => {
  if (window.confirm('移除该好友的授权并清除私人棋局？')) request({ type: 'revoke', id: current.management.opponent });
};
join.onclick = () => request({ type: 'join' });
reset.onclick = () => {
  if (window.confirm('清空当前对局？白方需要重新入席。')) request({ type: 'reset' });
};
function route() {
  room.hidden = location.hash !== '#gomoku';
  lobby.hidden = !room.hidden;
  if (!room.hidden) {
    render();
    request();
  }
}
addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) request(); });
setInterval(() => { if (!document.hidden && !room.hidden && telegram?.initData) request(); }, 1800);
route();
