import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove, hasFive, size } from './gomoku-ai.mjs';

const at = (x, y) => y * size + x;
function position(black, white) {
  const board = Array(size * size).fill(0);
  for (const [x, y] of black) board[at(x,y)] = 1;
  for (const [x, y] of white) board[at(x,y)] = 2;
  return board;
}

test('takes a win before blocking and otherwise blocks the sole winning reply', () => {
  const rival = [[0,9],[1,9],[2,9],[3,9]];
  const winning = position([[0,3],[1,3],[2,3],[3,3]], rival);
  assert.equal(chooseMove(winning), at(4,3));
  assert.equal(chooseMove(position([[7,7]], rival)), at(4,9));
});

test('creates a double threat on a crossing and leaves the input intact', () => {
  const board = position([[5,7],[6,7],[8,7],[7,5],[7,6],[7,8]], [[4,7],[7,4],[12,8],[12,10]]);
  const before = board.slice();
  const pick = chooseMove(board);
  assert.equal(pick, at(7,7));
  assert.deepEqual(board, before);
  board[pick] = 1;
  assert(hasFive(board, 9, 7, 1));
  assert(hasFive(board, 7, 9, 1));
});

test('blocks a rival fork before the two winning replies appear', () => {
  const board = position([[4,7],[7,4],[12,8],[12,10]], [[5,7],[6,7],[8,7],[7,5],[7,6],[7,8]]);
  assert.equal(chooseMove(board), at(7,7));
});

test('handles opening and finished boards', () => {
  assert.equal(chooseMove(position([], [])), at(7,7));
  assert.equal(chooseMove(Array(size * size).fill(2)), -1);
});

test('VCF marks a short forced double-ended four and does not mutate the board', async () => {
  const { findVCF } = await import('./gomoku-ai.mjs');
  const board = position([[1,1],[3,3]], [[5,7],[6,7],[7,7]]);
  const before = board.slice();
  const line = findVCF(board, 2);
  assert.equal(line.length, 3);
  assert.deepEqual(line.map(move => move.side), [2,1,2]);
  assert.deepEqual(board, before);
  for (const move of line) board[move.index] = move.side;
  const last = line.at(-1).index;
  assert(hasFive(board, last % size, Math.floor(last / size), 2));
  assert.equal(findVCF(position([[1,1]], [[7,7]]), 2), null);
});
