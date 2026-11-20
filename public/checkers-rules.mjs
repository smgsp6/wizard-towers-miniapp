const widths = [1,2,3,4,13,12,11,10,9,10,11,12,13,4,3,2,1];
export const holes = widths.flatMap((width, y) =>
  Array.from({ length: width }, (_, col) => ({ x: 2 * col - width + 1, y })));
const vectors = [[-2,0],[2,0],[-1,-1],[1,-1],[-1,1],[1,1]];
const byCoordinate = new Map(holes.map(({x,y}, i) => [`${x},${y}`, i]));
const adjacent = holes.map(({x,y}) => vectors.map(([dx,dy]) => [
  byCoordinate.get(`${x+dx},${y+dy}`), byCoordinate.get(`${x+2*dx},${y+2*dy}`),
]));

export function initialCheckers() {
  return { board: holes.map(({y}) => y < 4 ? 1 : y > 12 ? 2 : 0), turn: 1, winner: 0, last: [] };
}

export function routes(board, source) {
  if (!board[source]) return new Map();
  const paths = new Map();
  const jumped = new Map([[source, [source]]]);
  const queue = [source];
  for (const [near] of adjacent[source]) {
    if (near !== undefined && !board[near]) paths.set(near, [source, near]);
  }
  for (const current of queue) {
    for (const [near, landing] of adjacent[current]) {
      if (near === undefined || landing === undefined || near === source || !board[near] ||
          board[landing] || jumped.has(landing)) continue;
      const path = [...jumped.get(current), landing];
      jumped.set(landing, path);
      if (!paths.has(landing)) paths.set(landing, path);
      queue.push(landing);
    }
  }
  return paths;
}

export function playCheckers(state, source, destination) {
  if (state.winner || !Number.isInteger(source) || !Number.isInteger(destination) || state.board[source] !== state.turn) return null;
  const path = routes(state.board, source).get(destination);
  if (!path) return null;
  const board = state.board.slice();
  board[source] = 0;
  board[destination] = state.turn;
  const target = state.turn === 1 ? campBottom : campTop;
  const winner = target.every(hole => board[hole] === state.turn) ? state.turn : 0;
  return { board, winner, turn: 3 - state.turn, last: path };
}

const campTop = holes.flatMap(({y}, i) => y < 4 ? [i] : []);
const campBottom = holes.flatMap(({y}, i) => y > 12 ? [i] : []);
const distance = (a,b) => {
  const dy = Math.abs(holes[a].y - holes[b].y);
  return Math.max(dy, (Math.abs(holes[a].x - holes[b].x) + dy) / 2);
};

export function recommend(state, selected = null) {
  if (state.winner) return null;
  const occupied = state.board;
  const target = state.turn === 1 ? campBottom : campTop;
  const open = target.filter(index => occupied[index] !== state.turn);
  const direction = state.turn === 1 ? 1 : -1;
  const scoreAt = index => {
    const nearest = Math.min(...open.map(goal => distance(index, goal)));
    return -nearest * 4 + direction * holes[index].y + (target.includes(index) ? 12 : 0);
  };
  let best = null;
  for (let source = 0; source < holes.length; source++) {
    if (occupied[source] !== state.turn || (selected !== null && selected !== source)) continue;
    for (const [destination, path] of routes(occupied, source)) {
      const score = scoreAt(destination) - scoreAt(source) + path.length * 0.03;
      if (!best || score > best.score) best = { source, destination, path, score };
    }
  }
  return best;
}
