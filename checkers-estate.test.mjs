import test from 'node:test';
import assert from 'node:assert/strict';
import { holes, initialCheckers, playCheckers, recommend, routes } from './public/checkers-rules.mjs';
import { initialEstate, estateAction } from './public/estate.mjs';

const at = (x,y) => holes.findIndex(hole => hole.x === x && hole.y === y);

test('star has 121 holes and ten pieces per player', () => {
  const game = initialCheckers();
  assert.equal(holes.length, 121);
  assert.equal(game.board.filter(stone => stone === 1).length, 10);
  assert.equal(game.board.filter(stone => stone === 2).length, 10);
  const pick = recommend(game);
  assert(playCheckers(game, pick.source, pick.destination));
});

test('a multi-jump uses occupied midpoints and empty landings', () => {
  const game = initialCheckers();
  game.board.fill(0);
  const source = at(-8,8), middle = at(-4,8), end = at(0,8);
  game.board[source] = 1;
  game.board[at(-6,8)] = 2;
  game.board[at(-2,8)] = 2;
  assert.deepEqual(routes(game.board, source).get(end), [source, middle, end]);
  assert.equal(playCheckers(game, source, end).board[end], 1);
  game.board[middle] = 1;
  assert.equal(routes(game.board, source).has(end), false);
});

test('estate purchase, rent and public skills use the same ledger', () => {
  let game = estateAction(initialEstate(), 'boost');
  game = estateAction(game, 'roll', 1);
  assert.equal(game.phase, 'buy');
  game = estateAction(game, 'buy');
  assert.equal(game.players[0].cash, 540);
  assert.equal(game.turn, 1);
  game = estateAction(game, 'roll', 1);
  assert.equal(game.players[1].cash, 602);
  assert.equal(game.players[0].cash, 588);
  assert.equal(game.players[0].boost, 2);
});

test('estate finishes when the payer goes bankrupt', () => {
  const game = initialEstate();
  game.owners[1] = 1;
  game.players[0].cash = 1;
  const result = estateAction(game, 'roll', 1);
  assert.equal(result.phase, 'finished');
  assert.equal(result.winner, 1);
});
