export const blocks = [
  ['启程广场','start'], ['晨光面包店',110,24], ['运河书店',130,29], ['社区市集','gift'],
  ['北岸花房',135,32], ['星桥剧院',150,36], ['日常开支','fee'], ['云窗画廊',165,41],
  ['咖啡小院',160,38], ['社区市集','gift'], ['石阶陶坊',180,47], ['滨河茶室',195,54],
  ['松庭酒店',210,60], ['旧城唱片店',175,45], ['日常开支','fee'], ['光影展馆',225,66],
];
const initialPlayer = () => ({ cash: 650, at: 0, boost: 0, shield: 0 });
export function initialEstate() {
  return { players: [initialPlayer(), initialPlayer()], owners: Array(blocks.length).fill(null),
    turn: 0, rounds: 0, phase: 'roll', winner: null, notice: '橙方先掷骰。' };
}

const names = ['橙方','紫方'];
function endTurn(state) {
  state.rounds++;
  if (state.players[state.turn].cash < 0) {
    state.winner = 1 - state.turn;
    state.phase = 'finished';
  } else if (state.rounds >= 40) {
    const worth = state.players.map((player, side) => state.owners.reduce((sum, owner, index) =>
      sum + (owner === side ? blocks[index][1] : 0), player.cash));
    state.winner = worth[0] === worth[1] ? 2 : worth[0] > worth[1] ? 0 : 1;
    state.phase = 'finished';
  } else {
    state.turn = 1 - state.turn;
    state.phase = 'roll';
  }
}

export function estateAction(state, action, die = 0) {
  if (state.phase === 'finished') return state;
  const next = structuredClone(state);
  const side = state.turn;
  const player = next.players[side];
  if (state.phase === 'roll' && ['boost','shield'].includes(action) && !player[action]) {
    player[action] = 1;
    next.notice = `${names[side]}发动了${action === 'boost' ? '商圈推广' : '租金护盾'}。`;
    return next;
  }
  if (state.phase === 'buy' && ['buy','skip'].includes(action)) {
    const [name, price] = blocks[player.at];
    if (action === 'buy' && player.cash >= price) {
      player.cash -= price;
      next.owners[player.at] = side;
      next.notice = `${names[side]}买下了${name}。`;
    } else if (action === 'skip') next.notice = `${names[side]}放弃购买${name}。`;
    else return state;
    endTurn(next);
    return next;
  }
  if (state.phase !== 'roll' || action !== 'roll' || !Number.isInteger(die) || die < 1 || die > 6) return state;
  const steps = player.at + die;
  if (steps >= blocks.length) player.cash += 75;
  player.at = steps % blocks.length;
  const [name, type, rent] = blocks[player.at];
  next.notice = `${names[side]}掷出 ${die}，到达${name}。${steps >= blocks.length ? '经过起点，获得 75。' : ''}`;
  if (type === 'gift') {
    player.cash += 55;
    next.notice += '获得市集补贴 55。';
  } else if (type === 'fee') {
    player.cash -= 40;
    next.notice += '支付日常开支 40。';
  } else if (Number.isInteger(type) && next.owners[player.at] === null && player.cash >= type) {
    next.phase = 'buy';
    return next;
  } else if (next.owners[player.at] === 1 - side) {
    const other = next.players[1 - side];
    let due = rent;
    if (other.boost === 1) { due *= 2; other.boost = 2; }
    if (player.shield === 1) { due = Math.ceil(due / 2); player.shield = 2; }
    player.cash -= due;
    other.cash += due;
    next.notice += `支付租金 ${due}。`;
  }
  endTurn(next);
  return next;
}

export function mountEstate() {
  const view = document.querySelector('#estate');
  const menu = document.querySelector('#board-games');
  const board = document.querySelector('#estate-board');
  const notice = document.querySelector('#estate-status');
  const players = document.querySelector('#estate-players');
  const controls = [...document.querySelectorAll('[data-estate-action]')];
  const ring = [[4,4],[3,4],[2,4],[1,4],[0,4],[0,3],[0,2],[0,1],[0,0],[1,0],[2,0],[3,0],[4,0],[4,1],[4,2],[4,3]];
  const tiles = blocks.map(([name, type, rent], index) => {
    const tile = document.createElement('div');
    tile.className = 'estate-tile';
    const [x,y] = ring[index];
    tile.style.gridArea = `${y+1}/${x+1}`;
    const label = document.createElement('strong');
    label.textContent = name;
    const price = document.createElement('small');
    price.textContent = rent ? `${type} / 租 ${rent}` : '';
    const pieces = document.createElement('span');
    pieces.className = 'estate-pieces';
    tile.append(label, price, pieces);
    board.append(tile);
    return { tile, pieces };
  });
  let game = initialEstate();
  function render() {
    for (const [index, { tile, pieces }] of tiles.entries()) {
      tile.dataset.owner = game.owners[index] ?? '';
      pieces.textContent = game.players.map((player, side) => player.at === index ? side === 0 ? '🟠' : '🟣' : '').join('');
    }
    players.textContent = `橙方 ${game.players[0].cash} · 紫方 ${game.players[1].cash}`;
    notice.textContent = game.notice + (game.phase === 'finished' ? game.winner === 2 ? ' 平局。' : ` ${names[game.winner]}获胜。`
      : game.phase === 'buy' ? ' 可购买或跳过。' : ` 轮到${names[game.turn]}。`);
    for (const button of controls) {
      const action = button.dataset.estateAction;
      button.hidden = action === 'restart' ? false : ['buy','skip'].includes(action) ? game.phase !== 'buy' : game.phase !== 'roll';
      button.disabled = ['boost','shield'].includes(action) && Boolean(game.players[game.turn][action]);
    }
  }
  for (const button of controls) button.onclick = () => {
    const action = button.dataset.estateAction;
    if (action === 'restart') {
      if (game.rounds && game.phase !== 'finished' && !window.confirm('重新开始当前桌游？')) return;
      game = initialEstate();
    } else game = estateAction(game, action, action === 'roll' ? Math.floor(Math.random()*6) + 1 : 0);
    render();
  };
  render();
  return hash => {
    menu.hidden = hash !== '#board-games';
    view.hidden = hash !== '#estate';
    return !menu.hidden || !view.hidden;
  };
}
