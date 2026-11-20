export const blocks = [
  ['启程广场','start'], ['晨光面包店',110,24], ['运河书店',130,29], ['社区市集','gift'],
  ['北岸花房',135,32], ['星桥剧院',150,36], ['日常开支','fee'], ['云窗画廊',165,41],
  ['咖啡小院',160,38], ['社区市集','gift'], ['石阶陶坊',180,47], ['滨河茶室',195,54],
  ['松庭酒店',210,60], ['旧城唱片店',175,45], ['日常开支','fee'], ['光影展馆',225,66],
  ['银湾水族馆',230,70], ['河岸事件','event'], ['灯塔旅馆',205,58], ['渔港食堂',185,49],
  ['银湾机场','airport'], ['月台旅店',240,72], ['银杏展馆',220,64], ['中央钟楼',250,78],
  ['拘留所','jail'], ['风车工坊',175,46], ['棉纺仓库',205,58], ['工会事件','event'],
  ['青石影厅',220,65], ['茉莉药房',180,50], ['接受调查','detain'], ['剧场后台',235,69],
  ['远望天台',260,81], ['塔顶书房',230,70], ['山间事件','event'], ['山麓温泉',250,78],
  ['月湖机场','airport'], ['森林车站',240,74], ['月湖餐厅',265,84], ['湖心会馆',290,94],
];
const districts = ['晨光街','北岸街','滨河街','旧城街','银湾街','中央街','手作街','剧场街','望山街','月湖街'];
const events = [['周末市集客流增加', 65], ['道路维护摊费', -35], ['商户联盟发放补贴', 85], ['景观整修筹资', -50]];
const resalePrice = (state, index) => Math.floor((blocks[index][1] + state.levels[index] * upgradeCost(index)) * 0.65);
const maxFloors = 3;
const detentionFee = 70;
const flightFee = 90;
const airports = blocks.flatMap(([,type], index) => type === 'airport' ? [index] : []);
const destinationAirport = origin => airports.find(index => index !== origin);
const detentionIndex = blocks.findIndex(([,type]) => type === 'jail');
const upgradeCost = index => Math.ceil(blocks[index][1] * 0.45);
const names = ['橙方','紫方'];

function rentAt(state, index) {
  const rent = blocks[index][2];
  if (!rent) return 0;
  const owner = state.owners[index];
  const district = Math.floor(index / 4);
  const monopoly = owner !== null && blocks.every((block, i) => Math.floor(i / 4) !== district || !block[2] || state.owners[i] === owner);
  return Math.ceil(rent * (100 + 60 * state.levels[index]) * (monopoly ? 125 : 100) / 10000);
}

const initialPlayer = () => ({ cash: 650, at: 0, boost: 0, shield: 0, audit: false, detained: false });
export function initialEstate() {
  return { players: [initialPlayer(), initialPlayer()], owners: Array(blocks.length).fill(null),
    levels: Array(blocks.length).fill(0), turn: 0, rounds: 0, eventDraw: 0, die: null, phase: 'roll', winner: null, notice: '掷骰开始，沿街区前进。' };
}

function endTurn(state) {
  state.rounds++;
  if (state.players[state.turn].cash < 0) {
    state.winner = 1 - state.turn;
    state.phase = 'finished';
  } else if (state.rounds >= 40) {
    const worth = state.players.map((player, side) => state.owners.reduce((sum, owner, index) =>
      sum + (owner === side ? blocks[index][1] + state.levels[index] * upgradeCost(index) : 0), player.cash));
    state.winner = worth[0] === worth[1] ? 2 : worth[0] > worth[1] ? 0 : 1;
    state.phase = 'finished';
  } else {
    state.turn = 1 - state.turn;
    state.phase = state.players[state.turn].detained ? 'detention' : 'roll';
  }
}

export function estateAction(state, action, die = 0, target = null) {
  if (state.phase === 'finished') return state;
  const next = structuredClone(state);
  const side = state.turn;
  const player = next.players[side];
  if (state.phase === 'detention') {
    if (action === 'release' && player.cash >= detentionFee) {
      player.cash -= detentionFee;
      player.detained = false;
      next.phase = 'roll';
      next.notice = `${names[side]}缴费 ¥${detentionFee}，本回合可以掷骰。`;
    } else if (action === 'wait') {
      player.detained = false;
      next.notice = `${names[side]}停一回合，下一次可以正常掷骰。`;
      endTurn(next);
    } else return state;
    return next;
  }
  if (state.phase === 'flight') {
    if (action === 'fly' && player.cash >= flightFee) {
      player.cash -= flightFee;
      player.at = destinationAirport(player.at);
      next.notice = `${names[side]}支付 ¥${flightFee} 飞抵${blocks[player.at][0]}。`;
    } else if (action === 'stay') {
      next.notice = `${names[side]}选择留在${blocks[player.at][0]}。`;
    } else return state;
    endTurn(next);
    return next;
  }
  if (state.phase === 'roll' && ['boost','shield'].includes(action) && !player[action]) {
    player[action] = 1;
    next.notice = `${names[side]}发动了${action === 'boost' ? '商圈推广' : '租金护盾'}。`;
    return next;
  }
  if (state.phase === 'roll' && action === 'audit' && !player.audit && next.players[1 - side].boost === 1) {
    player.audit = true;
    next.players[1 - side].boost = 2;
    next.notice = `${names[side]}发动临时稽查，取消了对手的商圈推广。`;
    return next;
  }
  if (state.phase === 'roll' && action === 'sell' && Number.isInteger(target) && next.owners[target] === side) {
    const value = resalePrice(next, target);
    player.cash += value;
    next.owners[target] = null;
    next.levels[target] = 0;
    next.notice = `${names[side]}出售了${blocks[target][0]}，收回 ¥${value}。`;
    return next;
  }
  if (['buy','upgrade'].includes(state.phase) && [state.phase, 'skip'].includes(action)) {
    const [name, price] = blocks[player.at];
    if (action === 'buy' && player.cash >= price) {
      player.cash -= price;
      next.owners[player.at] = side;
      next.notice = `${names[side]}买下了${name}。`;
    } else if (action === 'upgrade' && player.cash >= upgradeCost(player.at)) {
      player.cash -= upgradeCost(player.at);
      next.levels[player.at]++;
      next.notice = `${names[side]}在${name}盖到 ${next.levels[player.at]} 层，租金提高至 ${rentAt(next, player.at)}。`;
    } else if (action === 'skip') next.notice = `${names[side]}跳过了${name}的地契操作。`;
    else return state;
    endTurn(next);
    return next;
  }
  if (state.phase !== 'roll' || action !== 'roll' || !Number.isInteger(die) || die < 1 || die > 6) return state;
  next.die = die;
  const steps = player.at + die;
  if (steps >= blocks.length) player.cash += 75;
  player.at = steps % blocks.length;
  const [name, type] = blocks[player.at];
  next.notice = `${names[side]}掷出 ${die}，到达${name}。${steps >= blocks.length ? '经过起点，获得 75。' : ''}`;
  if (type === 'airport' && player.cash >= flightFee) {
    next.phase = 'flight';
    next.notice += `可支付 ¥${flightFee} 飞往${blocks[destinationAirport(player.at)][0]}。`;
    return next;
  }
  if (type === 'detain') {
    player.at = detentionIndex;
    player.detained = true;
    next.notice += '前往拘留所，下回合选择缴费离开或停一回合。';
  } else if (type === 'jail') {
    next.notice += '本次只是探访。';
  } else if (type === 'gift') {
    player.cash += 55;
    next.notice += '获得市集补贴 55。';
  } else if (type === 'event') {
    const [description, amount] = events[next.eventDraw++ % events.length];
    player.cash += amount;
    next.notice += `${description}，${amount > 0 ? '获得' : '支付'} ¥${Math.abs(amount)}。`;
  } else if (type === 'fee') {
    player.cash -= 40;
    next.notice += '支付日常开支 40。';
  } else if (Number.isInteger(type) && next.owners[player.at] === null && player.cash >= type) {
    next.phase = 'buy';
    return next;
  } else if (next.owners[player.at] === side && next.levels[player.at] < maxFloors && player.cash >= upgradeCost(player.at)) {
    next.phase = 'upgrade';
    return next;
  } else if (next.owners[player.at] === 1 - side) {
    const other = next.players[1 - side];
    let due = rentAt(next, player.at);
    if (other.boost === 1) { due *= 2; other.boost = 2; }
    if (player.shield === 1) { due = Math.ceil(due / 2); player.shield = 2; }
    player.cash -= due;
    other.cash += due;
    next.notice += `支付租金 ${due}。`;
  }
  endTurn(next);
  return next;
}

export function mountEstate(telegram) {
  const view = document.querySelector('#estate-page');
  const menu = document.querySelector('#tabletop-category');
  const modeMenu = document.querySelector('#estate-menu-page');
  const board = document.querySelector('#estate-board');
  const viewport = document.querySelector('#estate-viewport');
  const overview = document.querySelector('#estate-overview');
  let opened = false;
  const notice = document.querySelector('#estate-status');
  const deed = document.querySelector('#estate-deed');
  const turn = document.querySelector('#estate-turn');
  const dice = document.querySelector('#estate-dice');
  const diceResult = document.querySelector('#estate-dice-result');
  const modeLabel = document.querySelector('#estate-mode');
  const adminRoot = document.querySelector('#estate-admin');
  const join = document.querySelector('#estate-join');
  const cube = dice.appendChild(document.createElement('span'));
  cube.className = 'estate-dice-cube';
  const faces = [[4], [0,8], [0,4,8], [0,2,6,8], [0,2,4,6,8], [0,2,3,5,6,8]];
  const angles = [[0,0], [0,-90], [-90,0], [90,0], [0,90], [0,180]];
  for (const [index, dots] of faces.entries()) {
    const face = cube.appendChild(document.createElement('span'));
    face.className = 'estate-dice-face';
    face.dataset.face = index + 1;
    for (let pip = 0; pip < 9; pip++) {
      const dot = face.appendChild(document.createElement('i'));
      dot.hidden = !dots.includes(pip);
    }
  }
  const pose = (x, y, lift = 0, tiltX = 0, tiltY = 0) =>
    `translateY(${lift}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateX(${x}deg) rotateY(${y}deg)`;
  let mode = '';
  let remote = null;
  let admin = null;
  let busy = false;
  let rolling = false;
  let shown = 5;
  let visibleEpoch = 0;
  let error = '';
  let local = initialEstate();
  const players = [...document.querySelectorAll('[data-estate-player]')];
  const controls = [...document.querySelectorAll('[data-estate-action]')];
  const edge = blocks.length / 4;
  const ring = Array.from({ length: blocks.length }, (_, index) => {
    const offset = index % edge;
    return [[edge-offset,edge],[0,edge-offset],[offset,0],[edge,offset]][Math.floor(index / edge)];
  });
  const marks = { start: '↻', gift: '+', fee: '−', event: '✦', jail: '▣', detain: '!', airport: '✈' };
  let game = local;
  let focused = 0;
  const tiles = blocks.map(([name, type, rent], index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'estate-tile';
    tile.dataset.district = Math.floor(index / 4);
    const [x,y] = ring[index];
    tile.style.gridArea = `${y+1}/${x+1}`;
    const label = document.createElement('strong');
    label.textContent = name;
    const badge = document.createElement('span');
    badge.className = 'estate-tile-badge';
    badge.textContent = marks[type] ?? '◆';
    const price = document.createElement('small');
    const pieces = document.createElement('span');
    pieces.className = 'estate-pieces';
    pieces.setAttribute('aria-hidden', 'true');
    const tokens = names.map((_, side) => {
      const token = document.createElement('i');
      token.dataset.side = side;
      pieces.append(token);
      return token;
    });
    const model = document.createElement('span');
    model.className = 'estate-model';
    model.setAttribute('aria-hidden', 'true');
    for (let level = 0; level < maxFloors; level++) {
      const floor = document.createElement('i');
      floor.style.setProperty('--floor', level);
      floor.append(document.createElement('b'), document.createElement('b'));
      model.append(floor);
    }
    tile.append(badge, label, price, model, pieces);
    tile.onclick = () => { focused = index; render(); };
    board.append(tile);
    return { tile, tokens, price, name, type, rent, model };
  });
  function follow(index, smooth = true) {
    const tile = tiles[index].tile;
    viewport.scrollTo({
      left: tile.offsetLeft - (viewport.clientWidth - tile.offsetWidth) / 2,
      top: tile.offsetTop - (viewport.clientHeight - tile.offsetHeight) / 2,
      behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
    });
  }
  overview.onclick = () => {
    const enabled = viewport.classList.toggle('overview');
    overview.setAttribute('aria-pressed', String(enabled));
    overview.textContent = enabled ? '放大' : '全图';
    if (!enabled) follow(focused, false);
  };
  function render() {
    const online = mode === 'online';
    const ready = !online || Boolean(remote?.joined);
    const canPlay = ready && (!online || remote.side === game.turn) && !busy && !rolling;
    join.hidden = !online || !remote || remote.joined || Boolean(remote.management);
    join.disabled = busy;
    if (admin && remote?.management) {
      const { allowed, opponent, nextDie } = remote.management;
      const values = allowed.join(',');
      if (admin.select.dataset.ids !== values) {
        admin.select.dataset.ids = values;
        admin.select.replaceChildren(new Option('选择已授权好友', ''), ...allowed.map(id => new Option(id, id)));
      }
      admin.select.value = opponent ?? '';
      admin.select.disabled = busy || rolling;
      admin.form.hidden = !remote.joined;
      admin.form.querySelectorAll('input,button').forEach(element => { element.disabled = busy || rolling; });
      admin.status.textContent = nextDie === null ? '下一次随机掷骰' : `已设置下一次掷出 ${nextDie} 点`;
    }
    for (const [index, { tile, tokens, price, name, type, rent, model }] of tiles.entries()) {
      tile.dataset.owner = game.owners[index] ?? '';
      tile.dataset.floors = game.levels[index];
      for (const [level, floor] of [...model.children].entries()) floor.hidden = level >= game.levels[index];
      tile.setAttribute('aria-pressed', String(index === focused));
      for (const [side, token] of tokens.entries()) token.hidden = game.players[side].at !== index;
      price.textContent = rent ? game.owners[index] !== null ? `租 ${rentAt(game,index)}` : `¥${type}` : '';
      tile.setAttribute('aria-label', `${name}${price.textContent ? '，' + price.textContent : ''}`);
    }
    for (const [side, card] of players.entries()) {
      card.dataset.active = String(game.phase !== 'finished' && side === game.turn);
      card.querySelector('strong').textContent = `¥${game.players[side].cash}`;
      card.querySelector('small').textContent = game.players[side].detained ? '拘留中' : `${game.owners.filter(owner => owner === side).length} 块地产`;
    }
    const [name, type, rent] = blocks[focused];
    deed.querySelector('strong').textContent = name;
    const owner = game.owners[focused];
    deed.querySelector('small').textContent = rent
      ? `${districts[Math.floor(focused / 4)]} · ${owner === null ? '待售' : names[owner] + '持有'}${game.levels[focused] ? ' · ' + game.levels[focused] + ' 层' : ''}`
      : { start: '经过可收取 ¥75', gift: '停留可获得 ¥55', fee: '停留需支付 ¥40', event: '触发一张街区事件卡', jail: '正常到达只算探访', detain: '进入拘留所，下回合选择离开方式', airport: `支付 ¥${flightFee} 飞往${blocks[destinationAirport(focused)]?.[0] ?? ''}` }[type];
    deed.querySelector('b').textContent = rent ? owner === null ? `¥${type}` : `租 ¥${rentAt(game,focused)}` : '';
    turn.textContent = game.phase === 'finished' ? game.winner === 2 ? '平局' : `${names[game.winner]}获胜`
      : `${names[game.turn]}行动 · 第 ${game.rounds + 1} / 40 回合`;
    diceResult.textContent = rolling ? '掷骰中' : game.die ? `掷出 ${game.die} 点` : '尚未掷骰';
    if (!rolling) {
      shown = game.die ?? 5;
      cube.style.transform = pose(...angles[shown - 1]);
      dice.dataset.result = game.die ?? '';
    }
    const message = error || (rolling ? '骰子翻滚中…'
      : online && !remote ? '正在连接好友对局…'
      : !ready ? remote.management ? '选择好友后等待入席' : '请入席开始对局'
      : online && game.turn !== remote.side && game.phase !== 'finished' ? game.notice + ' 等待对方操作。'
      : game.phase === 'detention' ? `缴费 ¥${detentionFee} 后可掷骰，或停一回合免费离开。` : game.notice);
    if (notice.textContent !== message) notice.textContent = message;
    for (const button of controls) {
      const action = button.dataset.estateAction;
      if (action === 'upgrade' && game.phase === 'upgrade') button.textContent = `盖第 ${game.levels[game.players[game.turn].at] + 1} 层 · ¥${upgradeCost(game.players[game.turn].at)}`;
      if (action === 'sell') {
        button.hidden = game.phase !== 'roll' || owner !== game.turn;
        if (!button.hidden) button.textContent = `卖出地契 · ¥${resalePrice(game, focused)}`;
      } else if (action === 'fly' || action === 'stay') {
        button.hidden = game.phase !== 'flight';
        if (action === 'fly') button.textContent = `搭乘航班 · ¥${flightFee}`;
      } else if (action === 'release' || action === 'wait') {
        button.hidden = game.phase !== 'detention';
        if (action === 'release') button.textContent = `缴费离开 · ¥${detentionFee}`;
      } else if (action === 'buy' || action === 'upgrade') button.hidden = game.phase !== action;
      else if (action === 'skip') button.hidden = !['buy','upgrade'].includes(game.phase);
      else if (action !== 'restart') button.hidden = game.phase !== 'roll';
      button.disabled = ['boost','shield'].includes(action) && Boolean(game.players[game.turn][action]);
      if (action === 'release') button.disabled = game.players[game.turn].cash < detentionFee;
      if (action === 'audit') button.disabled = game.players[game.turn].audit || game.players[1-game.turn].boost !== 1;
      if (action === 'restart') button.hidden = online && !remote?.management;
      else if (!ready) button.hidden = true;
      button.disabled ||= action === 'restart' ? busy || rolling || !ready : !canPlay;
    }
  }
  async function animateRoll(value) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || typeof cube.animate !== 'function') return;
    const [x,y] = angles[shown - 1];
    const [endX,endY] = angles[value - 1];
    rolling = true;
    render();
    try {
      await cube.animate([
        { transform: pose(x,y) },
        { transform: pose(x + 220, y + 125, -9, -41, -24), offset: .48 },
        { transform: pose(endX+360,endY+360) },
      ], { duration: 480, easing: 'cubic-bezier(.3,.1,.3,1)' }).finished;
    } catch {
      // The roll result is still valid if the browser cancels the animation.
    } finally {
      rolling = false;
    }
  }

  function attachAdmin(markup) {
    const template = document.createElement('template');
    template.innerHTML = markup;
    adminRoot.replaceChildren(template.content);
    const find = selector => adminRoot.querySelector(selector);
    admin = {
      select: find('#estate-opponent'), form: find('#estate-die-form'),
      input: find('#estate-next-die'), status: find('#estate-die-status'),
    };
    admin.select.onchange = () => {
      if (admin.select.value) request({ type: 'select', id: admin.select.value });
    };
    admin.form.onsubmit = event => {
      event.preventDefault();
      request({ type: 'set-die', value: admin.input.valueAsNumber });
    };
    find('#estate-clear-die').onclick = () => request({ type: 'set-die', value: null });
  }

  function detachAdmin() {
    adminRoot.replaceChildren();
    admin = null;
  }

  async function request(action) {
    if (busy || rolling || mode !== 'online') return;
    if (!telegram?.initData) {
      error = '请从 Telegram 小程序打开好友对局';
      render();
      return;
    }
    const epoch = visibleEpoch;
    const actor = game.turn;
    const headers = { 'X-Telegram-Init-Data': telegram.initData };
    busy = true;
    error = '';
    if (action) render();
    try {
      const response = await fetch('/api/estate', {
        method: action ? 'POST' : 'GET', headers,
        body: action ? JSON.stringify({ ...action, opponent: remote?.management?.opponent, revision: remote?.revision }) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const state = await response.json();
      if (epoch !== visibleEpoch) return;
      if (!response.ok) {
        if (response.status !== 409) {
          remote = null;
          game = initialEstate();
          detachAdmin();
        }
        error = state.error;
        return;
      }
      if (state.management && !admin) {
        const panel = await fetch('/api/estate-admin', { headers, signal: AbortSignal.timeout(8000) });
        if (!panel.ok) throw new Error();
        const markup = await panel.text();
        if (epoch !== visibleEpoch) return;
        attachAdmin(markup);
      }
      if (!state.management) detachAdmin();
      const differentRoom = remote?.management?.opponent !== state.management?.opponent || remote?.joined !== state.joined;
      if (action?.type === 'roll') {
        await animateRoll(state.game.die);
        if (epoch !== visibleEpoch) return;
      }
      remote = state;
      game = state.game;
      if (differentRoom || ['roll','fly'].includes(action?.type)) {
        focused = game.players[differentRoom ? game.turn : actor].at;
        follow(focused, !differentRoom);
      }
    } catch {
      if (epoch === visibleEpoch) {
        error = '连接中断，正在等待重连。';
        remote = null;
        game = initialEstate();
        detachAdmin();
      }
    } finally {
      busy = false;
      if (epoch === visibleEpoch) render();
      else if (mode === 'online') request();
    }
  }

  join.onclick = () => request({ type: 'join' });
  for (const button of controls) button.onclick = async () => {
    const action = button.dataset.estateAction;
    if (rolling || busy) return;
    if (action === 'restart' && (game.rounds || game.die) && game.phase !== 'finished' &&
        !window.confirm('重新开始当前桌游？')) return;
    if (mode === 'online') {
      request({ type: action === 'restart' ? 'reset' : action, ...(action === 'sell' && { target: focused }) });
      return;
    }
    const value = action === 'roll' ? Math.floor(Math.random()*6) + 1 : 0;
    if (value) {
      const epoch = visibleEpoch;
      await animateRoll(value);
      if (epoch !== visibleEpoch) {
        render();
        return;
      }
    }
    if (action === 'restart') {
      game = initialEstate();
      focused = 0;
      follow(0, false);
    } else {
      const actor = game.turn;
      game = estateAction(game, action, value, focused);
      if (action === 'roll' || action === 'fly') {
        focused = game.players[actor].at;
        follow(focused);
      }
    }
    local = game;
    render();
  };
  setInterval(() => {
    if (mode === 'online' && !document.hidden) request();
  }, 1800);
  render();
  return hash => {
    menu.hidden = hash !== '#board-games';
    modeMenu.hidden = hash !== '#estate-menu';
    const next = hash === '#estate' ? 'local' : hash === '#estate-online' ? 'online' : '';
    view.hidden = !next;
    if (mode !== next) {
      visibleEpoch++;
      mode = next;
      error = '';
      remote = null;
      game = mode === 'local' ? local : initialEstate();
      focused = 0;
      detachAdmin();
      modeLabel.textContent = mode === 'online' ? '好友对局' : '双人同屏';
      if (mode === 'online') request();
      render();
    }
    if (!view.hidden && !opened) {
      opened = true;
      requestAnimationFrame(() => follow(0, false));
    }
    return !menu.hidden || !view.hidden || !modeMenu.hidden;
  };
}
