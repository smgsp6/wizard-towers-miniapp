import { mountEstate } from './estate.mjs';
import { mountMusic } from './music.mjs';
import { mountCheckers } from './checkers.mjs';
const telegram = window.Telegram?.WebApp;
const showCheckers = mountCheckers(telegram);
const showEstate = mountEstate(telegram);
mountMusic();
const lobby = document.querySelector('#lobby');
const category = document.querySelector('#chess-category');
const gameMenu = document.querySelector('#gomoku-menu');
const room = document.querySelector('#room');
const board = document.querySelector('#board');
const status = document.querySelector('#status');
const join = document.querySelector('#join');
const practiceControls = document.querySelector('#practice-controls');
const practiceButtons = [...document.querySelectorAll('[data-start-color]')];
let vCells = null;
let adminUI = null;
const roomTitle = document.querySelector('#room-title');
const size = 15;
let current = null;
let pending = false;
let practice = false;

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
  button.onclick = () => {
    if (!vCells) return request({ type: 'move', x: index % size, y: Math.floor(index / size) });
    if (vCells.includes(index)) vCells = vCells.filter(cell => cell !== index);
    else if (vCells.length < 2) vCells.push(index);
    render();
  };
  board.append(button);
  return button;
});

function render(error = '') {
  const analysis = current?.management?.analysis;
  const line = analysis?.line ?? [];
  if (!current?.management?.vMode || !current.joined || current.result) vCells = null;
  const playable = current?.joined && current.side === current.turn && !current.result && !current.management?.ai && !pending;
  for (const [index, cell] of cells.entries()) {
    const stone = current?.board[index] ?? 0;
    cell.dataset.stone = stone;
    const step = line.findIndex(move => move.index === index);
    if (step >= 0) cell.dataset.step = step + 1;
    else delete cell.dataset.step;
    cell.dataset.last = String(current?.last === index);
    const vOrder = vCells?.indexOf(index) ?? -1;
    if (vOrder >= 0) cell.dataset.step = vOrder + 1;
    cell.disabled = !(playable || (vCells && !pending)) || Boolean(stone);
    const label = `第 ${Math.floor(index / size) + 1} 行，第 ${index % size + 1} 列`;
    cell.setAttribute('aria-label', stone ? `${label}，${stone === 1 ? '黑子' : '白子'}` : label);
  }
  const admin = current?.management;
  if (admin && adminUI) renderAdmin(admin, analysis, line);
  practiceControls.hidden = !practice || !current;
  for (const button of practiceButtons) button.disabled = pending;
  join.hidden = practice || !current || current.side !== 0 || current.joined;
  join.disabled = pending;
  let message = '正在连接对局…';
  if (current) {
    const { result, joined, side, turn } = current;
    if (admin && !admin.opponent) message = '请在管理员工具中选择对手';
    else if (side === 0) message = practice ? '选择黑方或白方开局' : '点击入席，开始对弈';
    else if (!joined) message = '等待获授权的好友入席';
    else if (result) message = ['','黑方获胜','白方获胜','和棋'][result];
    else if ((practice && side !== turn) || (admin?.ai && side === turn)) message = 'AI 正在思考';
    else message = side === turn ? `轮到你落子 · ${side === 1 ? '黑方' : '白方'}` : '等待对方落子';
  }
  const next = error || (vCells ? `已选 ${vCells.length} / 2 个落点` : message);
  if (status.textContent !== next) status.textContent = next;
}

function renderAdmin(admin, analysis, line) {
  const { reset, management, opponent, toggleAI, ownerColor, analysisPanel, analysisContext, analysisList, vMode, vActions, vStart, vSubmit, vCancel, resign, revoke } = adminUI;
  analysisContext.textContent = analysis?.afterMove
    ? '若走第 1 步，对手可以按标注强制成五。AI 已暂停，你可以另选一手，或考虑认输。'
    : '若直接轮到对手，对手有这条冲四胜线。AI 已暂停，你可以接手找防守，或考虑认输。';
  analysisPanel.hidden = !line.length;
  resign.disabled = pending;
  if (analysisList.dataset.line !== JSON.stringify(line)) {
    analysisList.dataset.line = JSON.stringify(line);
    analysisList.replaceChildren(...line.map(({ index, side }) => {
      const item = document.createElement('li');
      item.textContent = `${side === 1 ? '黑' : '白'} · 第 ${Math.floor(index / size) + 1} 行，第 ${index % size + 1} 列`;
      return item;
    }));
  }
  management.hidden = false;
  if (opponent.dataset.allowed !== admin.allowed.join(',')) {
    opponent.dataset.allowed = admin.allowed.join(',');
    opponent.replaceChildren(new Option('选择已授权好友', ''), ...admin.allowed.map(id => new Option(id, id)));
  }
  opponent.value = admin.opponent ?? '';
  toggleAI.hidden = revoke.hidden = vMode.hidden = !admin.opponent;
  vMode.textContent = admin.vMode ? '关闭 V 模式' : '开启 V 模式';
  vMode.disabled = pending;
  toggleAI.textContent = admin.ai ? '手动接管' : '启用 AI 代下';
  opponent.disabled = toggleAI.disabled = revoke.disabled = pending;
  ownerColor.value = current.side;
  ownerColor.disabled = pending || !admin.opponent || current.last !== null;
  vActions.hidden = !admin?.vMode || !current?.joined || Boolean(current.result);
  vStart.hidden = Boolean(vCells);
  vStart.disabled = pending;
  vSubmit.hidden = vCancel.hidden = !vCells;
  vSubmit.disabled = pending || vCells?.length !== 2;
  reset.hidden = !admin.opponent || !current.joined;
  reset.disabled = pending;
}

async function loadAdmin(initData) {
  const response = await fetch('/api/admin-panel', {
    headers: { 'X-Telegram-Init-Data': initData },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('无法加载管理界面');
  const root = document.createElement('div');
  const template = document.createElement('template');
  template.innerHTML = await response.text();
  root.append(template.content);
  const find = id => root.querySelector(id);
  const { reset, management, opponent, toggleAI, ownerColor, analysisPanel, analysisContext, analysisList, vMode, vActions, vStart, vSubmit, vCancel, resign, revoke, authorize, friend } = adminUI = {
    root,
    reset: find('#reset'),
    management: find('#management'),
    opponent: find('#opponent'),
    toggleAI: find('#toggle-ai'),
    ownerColor: find('#owner-color'),
    analysisPanel: find('#analysis'),
    analysisContext: find('#analysis-context'),
    analysisList: find('#analysis-line'),
    vMode: find('#v-mode'),
    vActions: find('#v-actions'),
    vStart: find('#v-start'),
    vSubmit: find('#v-submit'),
    vCancel: find('#v-cancel'),
    resign: find('#resign'),
    revoke: find('#revoke'),
    authorize: find('#authorize'),
    friend: find('#friend-id'),
  };
  room.querySelector('.arena').before(root);

  authorize.onsubmit = event => {
    event.preventDefault();
    request({ type: 'authorize', id: friend.value.trim() });
  };
  opponent.onchange = () => {
    if (opponent.value) request({ type: 'select', id: opponent.value });
  };
  vMode.onclick = () => request({ type: 'v-mode', enabled: !current.management.vMode });
  vStart.onclick = () => { vCells = []; render(); };
  vCancel.onclick = () => { vCells = null; render(); };
  vSubmit.onclick = () => request({ type: 'v-move', cells: vCells });
  resign.onclick = () => {
    if (window.confirm('确认认输并结束本局？')) request({ type: 'resign' });
  };
  ownerColor.onchange = () => request({ type: 'color', side: Number(ownerColor.value) });
  toggleAI.onclick = () => request({ type: 'mode', ai: !current.management.ai });
  revoke.onclick = () => {
    if (window.confirm('移除该好友的授权并清除私人棋局？')) request({ type: 'revoke', id: current.management.opponent });
  };
  reset.onclick = () => {
    if (window.confirm('清空当前对局？好友需要重新入席。')) request({ type: 'reset' });
  };
}

function removeAdmin() {
  adminUI?.root.remove();
  adminUI = null;
  vCells = null;
}

async function request(action) {
  if (pending || room.hidden) return;
  const initData = telegram?.initData;
  if (!initData) {
    render('请从 Telegram 小程序打开，才能加入对局。');
    return;
  }
  if (action && current?.management) action = { ...action, opponent: current.management.opponent };
  const requestPractice = practice;
  pending = true;
  if (action) render();
  let error = '';
  try {
    const response = await fetch(requestPractice ? '/api/practice' : '/api/room', {
      method: action ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': initData, ...(action && { 'Content-Type': 'application/json' }) },
      body: action ? JSON.stringify(action) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (requestPractice !== practice) return;
    if (response.ok) {
      if (data.management && !adminUI) await loadAdmin(initData);
      if (requestPractice !== practice || room.hidden) {
        removeAdmin();
        return;
      }
      if (!data.management) removeAdmin();
      if (action || current?.management?.opponent !== data.management?.opponent) vCells = null;
      current = data;
    }
    else {
      if (response.status !== 409) {
        current = null;
        removeAdmin();
      }
      error = data.error;
    }
  } catch {
    current = null;
    removeAdmin();
    error = '连接中断，正在等待重连。';
  } finally {
    pending = false;
    if (requestPractice === practice) render(error);
    else request();
  }
}

for (const button of practiceButtons) button.onclick = () => {
  if (current?.joined && !current.result && current.last !== null && !window.confirm('结束这局并重新开局？')) return;
  request({ type: 'start', side: Number(button.dataset.startColor) });
};
join.onclick = () => request({ type: 'join' });
function route() {
  const hash = location.hash;
  const nextPractice = hash === '#practice';
  const inRoom = nextPractice || hash === '#gomoku-room';
  if (hash !== '#gomoku-room') removeAdmin();
  if (nextPractice !== practice || !inRoom) current = null;
  practice = nextPractice;
  roomTitle.textContent = practice ? '人机练习' : '五子棋';
  room.hidden = !inRoom;
  category.hidden = hash !== '#games';
  gameMenu.hidden = hash !== '#gomoku';
  const checkersVisible = showCheckers(hash);
  const estateVisible = showEstate(hash);
  lobby.hidden = inRoom || !category.hidden || !gameMenu.hidden || checkersVisible || estateVisible;
  requestAnimationFrame(() => window.scrollTo(0, 0));
  if (!room.hidden) {
    render();
    request();
  }
}
addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) request(); });
setInterval(() => { if (!document.hidden && !room.hidden && telegram?.initData) request(); }, 1800);
route();
