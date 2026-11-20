import { holes, initialCheckers, playCheckers, recommend, routes } from './checkers-rules.mjs';

export function mountCheckers(telegram) {
  const menu = document.querySelector('#checkers-menu');
  const view = document.querySelector('#checkers-play');
  const board = document.querySelector('#checkers-board');
  const status = document.querySelector('#checkers-status');
  const adminRoot = document.querySelector('#checkers-admin');
  const join = document.querySelector('#checkers-join');
  const restart = document.querySelector('#checkers-restart');
  let mode = '';
  let local = initialCheckers();
  let current = null;
  let selected = null;
  let hint = [];
  let admin = null;
  let busy = false;
  let computerTimer;
  let error = '';
  let generation = 0;

  const buttons = holes.map(({x,y}, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'checker-hole';
    button.style.setProperty('--x', x + 12);
    button.style.setProperty('--y', y);
    button.dataset.camp = y < 4 ? '1' : y > 12 ? '2' : '0';
    button.onclick = () => turn(index);
    board.append(button);
    return button;
  });

  function render() {
    const online = mode === 'room';
    const game = (online ? current : local) ?? initialCheckers();
    const side = online ? current?.side : 1;
    const playable = !busy && !game.winner && side === game.turn;
    const options = selected === null ? new Map() : routes(game.board, selected);
    for (const [index, button] of buttons.entries()) {
      const stone = game.board[index];
      button.dataset.stone = stone;
      button.dataset.selected = String(index === selected);
      button.dataset.target = String(options.has(index));
      button.dataset.last = String(game.last.at(-1) === index);
      const step = hint.indexOf(index);
      if (step >= 0) button.dataset.hint = String(step + 1);
      else delete button.dataset.hint;
      const movable = playable && stone === side && (index === selected || routes(game.board, index).size > 0);
      button.disabled = !playable || !(movable || options.has(index));
      button.setAttribute('aria-label', `第 ${holes[index].y + 1} 行，位置 ${index + 1}${stone ? stone === 1 ? '，琥珀棋' : '，紫棋' : ''}`);
    }
    join.hidden = !online || current?.side !== 0;
    join.disabled = busy;
    restart.hidden = online;
    if (admin && current?.management) {
      const { allowed, opponent } = current.management;
      if (admin.select.dataset.ids !== allowed.join(',')) {
        admin.select.dataset.ids = allowed.join(',');
        admin.select.replaceChildren(new Option('选择已授权好友', ''), ...allowed.map(id => new Option(id, id)));
      }
      admin.select.value = opponent ?? '';
      admin.select.disabled = busy;
      admin.hint.hidden = !current.joined || game.turn !== 1 || Boolean(game.winner);
      admin.reset.hidden = !current.joined;
      admin.hint.disabled = admin.reset.disabled = busy;
    }
    const message = error || (online && !current ? '正在连接对局…'
      : online && !game.joined ? side === 0 ? '点击入席，执紫棋' : '选择好友后等待对方入席'
      : game.winner ? game.winner === 1 ? '琥珀方获胜' : '紫方获胜'
      : playable ? `轮到你走棋 · ${side === 1 ? '琥珀方' : '紫方'}`
      : online ? '等待对方走棋' : '电脑正在走棋');
    if (status.textContent !== message) status.textContent = message;
  }

  function turn(index) {
    const game = mode === 'room' ? current : local;
    if (game.board[index] === game.turn && index !== selected) {
      selected = index;
      render();
      return;
    }
    if (index === selected) selected = null;
    else if (selected !== null) {
      const source = selected;
      selected = null;
      if (mode === 'room') {
        request({ type: 'move', source, destination: index });
        return;
      }
      local = playCheckers(local, source, index) ?? local;
      queueComputer();
    }
    render();
  }

  function queueComputer() {
    clearTimeout(computerTimer);
    if (mode !== 'practice' || local.winner || local.turn !== 2) return;
    computerTimer = setTimeout(() => {
      const move = recommend(local);
      if (move) local = playCheckers(local, move.source, move.destination);
      else local = { ...local, turn: 1, last: [] };
      render();
    }, 650);
  }

  async function loadAdmin(signal) {
    const response = await fetch('/api/checkers-admin', {
      headers: { 'X-Telegram-Init-Data': telegram.initData }, signal,
    });
    if (!response.ok) throw new Error('无法加载管理员工具');
    return response.text();
  }

  function mountAdmin(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    adminRoot.replaceChildren(template.content);
    admin = {
      select: adminRoot.querySelector('#checkers-opponent'),
      hint: adminRoot.querySelector('#checkers-hint'),
      reset: adminRoot.querySelector('#checkers-reset'),
      caption: adminRoot.querySelector('#checkers-hint-status'),
    };
    admin.select.onchange = () => request({ type: 'select', id: admin.select.value });
    admin.hint.onclick = () => request({ type: 'hint' });
    admin.reset.onclick = () => {
      if (window.confirm('清空当前跳棋对局？')) request({ type: 'reset' });
    };
  }

  function clearAdmin() {
    adminRoot.replaceChildren();
    admin = null;
    hint = [];
  }

  async function request(action) {
    if (busy || mode !== 'room') return;
    if (!telegram?.initData) {
      error = '请从 Telegram 小程序打开好友对弈';
      render();
      return;
    }
    const requestGeneration = generation;
    busy = true;
    if (action) render();
    error = '';
    try {
      const signal = AbortSignal.timeout(8000);
      const response = await fetch('/api/checkers', {
        method: action ? 'POST' : 'GET',
        headers: { 'X-Telegram-Init-Data': telegram.initData },
        body: action ? JSON.stringify({ ...action, opponent: current?.management?.opponent }) : undefined,
        signal,
      });
      const state = await response.json();
      if (requestGeneration !== generation) return;
      if (!response.ok) {
        if (response.status !== 409) {
          current = null;
          clearAdmin();
        }
        error = state.error;
        return;
      }
      const markup = state.management && !admin ? await loadAdmin(signal) : null;
      if (requestGeneration !== generation) return;
      if (markup) mountAdmin(markup);
      if (!state.management) clearAdmin();
      const changed = current?.turn !== state.turn || current?.last.at(-1) !== state.last.at(-1) ||
        current?.management?.opponent !== state.management?.opponent || Boolean(action && action.type !== 'hint');
      if (changed) {
        hint = [];
        selected = null;
        if (admin) admin.caption.textContent = '';
      }
      if (state.management?.hint) {
        hint = state.management.hint;
        admin.caption.textContent = hint.length ? '棋盘编号依次标出起点和落点。' : '当前没有可走的路线。';
      }
      current = state;
    } catch {
      if (requestGeneration === generation) {
        error = '连接中断，正在等待重连。';
        current = null;
        clearAdmin();
      }
    } finally {
      busy = false;
      if (requestGeneration === generation) render();
      else if (mode === 'room') request();
    }
  }

  join.onclick = () => request({ type: 'join' });
  restart.onclick = () => {
    clearTimeout(computerTimer);
    local = initialCheckers();
    selected = null;
    render();
  };
  setInterval(() => { if (mode === 'room' && !document.hidden && telegram?.initData) request(); }, 1800);
  return hash => {
    menu.hidden = hash !== '#checkers';
    const next = hash === '#checkers-room' ? 'room' : hash === '#checkers-practice' ? 'practice' : '';
    view.hidden = !next;
    if (mode !== next) {
      generation++;
      mode = next;
      current = null;
      selected = null;
      error = '';
      clearAdmin();
      document.querySelector('#checkers-title').textContent = mode === 'practice' ? '跳棋 · 人机对战' : '跳棋 · 好友对弈';
      queueComputer();
      if (mode === 'room') request();
    }
    if (mode) render();
    return !menu.hidden || !view.hidden;
  };
}
