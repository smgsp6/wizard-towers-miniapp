export const size = 15;
const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
const cells = size * size;
const mate = 1_000_000;
const center = Math.floor(cells / 2);
const geometry = Array.from({ length: cells }, (_, index) => {
  const x = index % size, y = Math.floor(index / size);
  const at = (dx, dy) => {
    const col = x + dx, row = y + dy;
    return col >= 0 && col < size && row >= 0 && row < size ? row * size + col : -1;
  };
  return {
    distance: Math.abs(x - 7) + Math.abs(y - 7),
    lines: directions.map(([dx, dy]) => Array.from({ length: 9 }, (_, i) => at((i - 4) * dx, (i - 4) * dy))),
    neighbors: Array.from({ length: 25 }, (_, i) => at(i % 5 - 2, Math.floor(i / 5) - 2)).filter(cell => cell >= 0),
  };
});

export function hasFive(board, x, y, side) {
  return geometry[y * size + x].lines.some(line => {
    let count = 1;
    for (const step of [-1, 1]) {
      for (let i = 4 + step; board[line[i]] === side; i += step) count++;
    }
    return count >= 5;
  });
}

function shape(board, index, side) {
  let wins = 0, threes = 0, value = 0;
  for (const line of geometry[index].lines) {
    let stones = 16, blocked = 0;
    for (let i = 0; i < 9; i++) {
      if (i === 4) continue;
      const cell = line[i];
      if (board[cell] === side) stones |= 1 << i;
      else if (cell < 0 || board[cell]) blocked |= 1 << i;
    }
    let threats = 0, best = 0;
    for (let start = 0; start <= 4; start++) {
      const mask = 31 << start;
      if (blocked & mask) continue;
      const empty = mask & ~stones;
      if (!empty) return mate;
      if (!(empty & (empty - 1))) threats |= empty;
      else {
        const remaining = empty & (empty - 1);
        best = Math.max(best, remaining & (remaining - 1) ? 8 : 36);
      }
    }
    if (threats) wins += threats & (threats - 1) ? 2 : 1;
    if (!threats) {
      for (let start = 0; start <= 3; start++) {
        const middle = 30 << start;
        if (!(middle & 16) || (blocked & (63 << start)) || (stones & (33 << start))) continue;
        const gap = middle & ~stones;
        if (gap && !(gap & (gap - 1))) {
          threes++;
          break;
        }
      }
    }
    value += best;
  }
  return value + (wins >= 2 ? 35000 : wins && threes ? 9500 : wins ? 3300 : threes >= 2 ? 4300 : threes * 420);
}

function rank(board, side) {
  const options = [];
  for (let index = 0; index < cells; index++) {
    if (board[index] || !geometry[index].neighbors.some(cell => board[cell])) continue;
    const attack = shape(board, index, side);
    const defense = shape(board, index, 3 - side);
    options.push({ index, attack, defense, priority: attack * 1.08 + defense - geometry[index].distance });
  }
  options.sort((a, b) => b.priority - a.priority);
  const wins = options.filter(move => move.attack === mate);
  const blocks = options.filter(move => move.defense === mate);
  return { options: wins.length ? wins : blocks.length ? blocks : options, win: Boolean(wins.length), forced: Boolean(blocks.length), lost: !wins.length && blocks.length > 1 };
}

export function chooseMove(position, side = 1) {
  if (!position.some(Boolean)) return center;
  const board = position.slice();
  const root = rank(board, side);
  if (!root.options.length) return -1;
  if (root.win || root.forced) return root.options[0].index;

  let nodes = 0;
  const limit = 600;
  const cutoff = Symbol('search budget');

  function search(player, depth, ply, alpha, beta) {
    if (++nodes > limit) throw cutoff;
    const ranked = rank(board, player);
    if (ranked.win) return mate - ply;
    if (ranked.lost) return -mate + ply + 1;
    if (!ranked.options.length) return 0;
    if (depth <= 0 && (!ranked.forced || ply >= 8)) {
      const attack = Math.max(...ranked.options.map(move => move.attack));
      const defense = Math.max(...ranked.options.map(move => move.defense));
      return (attack * 1.18 - defense) / (ranked.forced ? 20 : 1);
    }
    let best = -Infinity;
    for (const move of ranked.options.slice(0, ranked.forced ? 1 : ply === 1 ? 9 : 5)) {
      board[move.index] = player;
      let score;
      try {
        score = -search(3 - player, depth - 1, ply + 1, -beta, -alpha);
      } finally {
        board[move.index] = 0;
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = root.options[0];
  for (const depth of [2, 3, 4]) {
    let next = best, score = -Infinity;
    const candidates = [best, ...root.options.filter(move => move !== best)].slice(0, 13);
    try {
      for (const move of candidates) {
        board[move.index] = side;
        let value;
        try {
          value = -search(3 - side, depth - 1, 1, -Infinity, -score);
        } finally {
          board[move.index] = 0;
        }
        if (value > score) {
          score = value;
          next = move;
        }
      }
    } catch (error) {
      if (error !== cutoff) throw error;
      break;
    }
    best = next;
    if (Math.abs(score) > mate / 2) break;
  }
  return best.index;
}
