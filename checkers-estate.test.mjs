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

test('estate upgrades and complete districts increase rent and debit the correct player', () => {
  const start = initialEstate();
  start.players[0].at = 39;
  start.owners[1] = start.owners[2] = 0;
  let game = estateAction(start, 'roll', 2);
  assert.equal(game.phase, 'upgrade');
  game = estateAction(game, 'upgrade');
  assert.equal(game.levels[1], 1);
  assert.equal(game.players[0].cash, 675);
  game = estateAction(game, 'roll', 1);
  assert.equal(game.players[1].cash, 602);
  assert.equal(game.players[0].cash, 723);
});

test('estate events, opponent audit and resales change only the relevant ledger', () => {
  const start = initialEstate();
  start.players[0].at = 16;
  start.players[1].boost = 1;
  start.owners[1] = 0;
  let game = estateAction(start, 'audit');
  assert.equal(game.players[1].boost, 2);
  assert.equal(game.players[0].audit, true);
  game = estateAction(game, 'sell', 0, 1);
  assert.equal(game.owners[1], null);
  assert.equal(game.players[0].cash, 721);
  game = estateAction(game, 'roll', 1);
  assert.equal(game.players[0].cash, 786);
  assert.equal(game.eventDraw, 1);
});

test('estate detention distinguishes visiting, paying and waiting', () => {
  const start = initialEstate();
  start.players[0].at = 23;
  const visit = estateAction(start, 'roll', 1);
  assert.equal(visit.players[0].at, 24);
  assert.equal(visit.players[0].detained, false);

  start.players[0].at = 29;
  const sent = estateAction(start, 'roll', 1);
  assert.equal(sent.players[0].at, 24);
  assert.equal(sent.players[0].detained, true);
  let game = estateAction(sent, 'roll', 3);
  assert.equal(game.turn, 0);
  assert.equal(game.phase, 'detention');
  assert.equal(estateAction(game, 'roll', 6), game);
  const paid = estateAction(game, 'release');
  assert.equal(paid.players[0].cash, 580);
  assert.equal(paid.players[0].detained, false);
  assert.equal(paid.phase, 'roll');
  assert.equal(paid.turn, 0);

  game.players[0].cash = 60;
  assert.equal(estateAction(game, 'release'), game);
  const waited = estateAction(game, 'wait');
  assert.equal(waited.players[0].cash, 60);
  assert.equal(waited.players[0].detained, false);
  assert.equal(waited.turn, 1);
});

test('estate airports allow optional paid travel without a start bonus', () => {
  const first = initialEstate();
  first.players[0].at = 35;
  const landed = estateAction(first, 'roll', 1);
  assert.equal(landed.phase, 'flight');
  assert.equal(landed.players[0].at, 36);
  const flown = estateAction(landed, 'fly');
  assert.equal(flown.players[0].at, 20);
  assert.equal(flown.players[0].cash, 560);
  assert.equal(flown.turn, 1);
  const stayed = estateAction(landed, 'stay');
  assert.equal(stayed.players[0].at, 36);
  assert.equal(stayed.players[0].cash, 650);
  assert.equal(stayed.turn, 1);
  first.players[0].cash = 50;
  assert.equal(estateAction(first, 'roll', 1).phase, 'roll');
});
