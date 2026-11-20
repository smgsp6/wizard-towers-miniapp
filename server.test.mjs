import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasFive, makeServer, telegramID } from './server.mjs';

const token = 'synthetic-bot-token';
function signed(id, issued = Math.floor(Date.now() / 1000)) {
  const user = JSON.stringify({ id, first_name: 'Synthetic' });
  const check = `auth_date=${issued}\nuser=${user}`;
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', key).update(check).digest('hex');
  return new URLSearchParams({ user, auth_date: issued, hash }).toString();
}

test('login verifies signature, freshness and distinct signed keys', () => {
  assert.equal(telegramID(signed(42), token), '42');
  assert.equal(telegramID(signed(42, Math.floor(Date.now() / 1000) - 3700), token), null);
  assert.equal(telegramID(signed(42, Math.floor(Date.now() / 1000) + 60), token), null);
  assert.equal(telegramID(signed(42).replace('42', '43'), token), null);
  assert.equal(telegramID(signed(42) + '&user=duplicate', token), null);
});

test('counts all four directions, and a broken line is not a win', () => {
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    const board = Array(225).fill(0);
    for (let i = -2; i <= 2; i++) board[(7 + i * dy) * 15 + 7 + i * dx] = 1;
    assert.equal(hasFive(board, 7, 7, 1), true);
    board[(7 + dy) * 15 + 7 + dx] = 2;
    assert.equal(hasFive(board, 7, 7, 1), false);
  }
});

test('only the owner and the seated authorized guest can play', async t => {
  const server = makeServer({ token, owner: '101', allowed: ['202', '303'] }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  async function call(id, body) {
    if (id === 101 && body) body = { opponent: '202', ...body };
    const res = await fetch(address + '/api/room', {
      method: body ? 'POST' : 'GET',
      headers: id ? { 'X-Telegram-Init-Data': signed(id) } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return [res.status, await res.json()];
  }
  const move = (id, x, y) => call(id, {type:'move', x, y});
  const page = await fetch(address);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>游戏大厅<\/title>/);
  assert.doesNotMatch(html, /id="(?:management|analysis|v-actions|reset)"|管理员工具/);
  const getPanel = id => fetch(address + '/api/admin-panel', {
    headers: id ? { 'X-Telegram-Init-Data': signed(id) } : {},
  });
  assert.equal((await getPanel(null)).status, 401);
  assert.equal((await getPanel(202)).status, 403);
  assert.equal((await getPanel(404)).status, 403);
  assert.equal((await fetch(address + '/admin-panel.html')).status, 404);
  const panel = await getPanel(101);
  assert.equal(panel.status, 200);
  assert.equal(panel.headers.get('cache-control'), 'no-store');
  assert.match(await panel.text(), /管理员工具/);
  assert.equal((await call(null))[0], 401);
  assert.equal((await call(404))[0], 403);
  assert.equal((await move(101,0,0))[0], 409);
  const fetchCheckers = async (id, body, path = 'checkers') => {
    const reply = await fetch(address + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': signed(id) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return [reply.status, await reply.text()];
  };
  assert.equal((await fetchCheckers(202, null, 'checkers-admin'))[0], 403);
  assert.match((await fetchCheckers(101, null, 'checkers-admin'))[1], /计算推荐路线/);
  assert.equal((await fetchCheckers(101, { type: 'select', id: '202' }))[0], 200);
  assert.equal((await fetchCheckers(202, { type: 'join' }))[0], 200);
  assert.equal((await fetchCheckers(202, { type: 'hint' }))[0], 400);
  const [, hintBody] = await fetchCheckers(101, { type: 'hint', opponent: '202' });
  assert(JSON.parse(hintBody).management.hint.length >= 2);
  assert.equal(JSON.parse((await fetchCheckers(202))[1]).management, undefined);
  assert.equal(JSON.parse((await fetchCheckers(303))[1]).joined, false);
  assert.equal((await call(101,{type:'select',id:'202'}))[0], 200);
  assert.equal((await call(202,{type:'join'}))[1].side, 2);
  assert.equal((await call(303,{type:'join'}))[1].side, 2);
  assert.equal((await call(303,{type:'select',id:'202'}))[0], 400);
  assert.equal((await move(202,0,1))[0], 409);
  for (let x = 0; x < 4; x++) {
    assert.equal((await move(101,x,0))[0], 200);
    assert.equal((await move(202,x,0))[0], 409);
    assert.equal((await move(202,x,1))[0], 200);
  }
  const [status, state] = await move(101,4,0);
  assert.equal(status, 200);
  assert.equal(state.result, 1);
  const [, other] = await call(303);
  assert(other.board.every(stone => stone === 0));
  assert.equal(other.result, 0);
  assert.equal(other.management, undefined);
  assert.equal((await call(303,{type:'mode',ai:true}))[0], 400);
  assert.equal((await move(202,4,1))[0], 409);
  assert.equal((await call(202,{type:'reset'}))[0], 400);
  const [, reset] = await call(101,{type:'reset'});
  assert.equal(reset.joined, false);
  assert(reset.board.every(stone => stone === 0));
});

test('AI waits, can be canceled, and never exposes controls to the guest', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gomoku-test-'));
  const stateFile = join(directory, 'state.json');
  const options = { token, owner: '101', allowed: ['202'], stateFile, webhookSecret: 'synthetic-secret' };
  let server = makeServer(options).listen(0, '127.0.0.1');
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, 'listening');
  async function call(id, body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/room`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': signed(id) },
      body: body ? JSON.stringify({ opponent: '202', ...body }) : undefined,
    });
    return [res.status, await res.json()];
  }
  const started = Date.now();
  await call(101, { type: 'select', id: '202' });
  await call(101, { type: 'mode', ai: true });
  const [, entered] = await call(202, { type: 'join' });
  assert.equal(entered.last, null);
  assert.equal(entered.management, undefined);
  let saved = JSON.parse(await readFile(stateFile, 'utf8'));
  const deadline = saved.rooms['202'].dueAt;
  assert(deadline >= started + 3000 && deadline <= Date.now() + 10000);
  await new Promise(resolve => server.close(resolve));
  server = makeServer(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const stop = deadline + 2000;
  let current;
  do {
    [, current] = await call(202);
    if (current.last !== null) break;
    await new Promise(resolve => setTimeout(resolve, 80));
  } while (Date.now() < stop);
  assert.equal(current.board[112], 1);
  assert.equal(current.turn, 2);
  assert(Date.now() >= deadline);
  await call(202, { type: 'move', x: 8, y: 7 });
  await call(101, { type: 'mode', ai: false });
  saved = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(saved.rooms['202'].dueAt, null);
  assert.equal((await call(101, { type: 'move', x: 6, y: 7 }))[0], 200);
  await call(101, { type: 'revoke', id: '202' });
  assert.equal((await call(202))[0], 403);

  const webhook = (secret, type) => fetch(`http://127.0.0.1:${server.address().port}/api/telegram`, {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { from: {id:202}, chat: {id:202,type}, text:'/id' } }),
  });
  assert.equal((await webhook('incorrect', 'private')).status, 403);
  assert.deepEqual(await (await webhook('synthetic-secret', 'group')).json(), {});
  assert.equal((await (await webhook('synthetic-secret', 'private')).json()).chat_id, 202);
});

test('players can switch colors before play and practice stays separate', async t => {
  const server = makeServer({ token, owner: '101', allowed: ['202'] }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  async function call(path, id, body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Telegram-Init-Data': signed(id) },
      body: body ? JSON.stringify({ opponent: '202', ...body }) : undefined,
    });
    return [res.status, await res.json()];
  }
  await call('room', 101, { type: 'select', id: '202' });
  assert.equal((await call('room', 101, { type: 'color', side: 2 }))[1].side, 2);
  assert.equal((await call('room', 202, { type: 'join' }))[1].side, 1);
  assert.equal((await call('room', 101, { type: 'move', x: 1, y: 1 }))[0], 409);
  assert.equal((await call('room', 202, { type: 'move', x: 1, y: 1 }))[1].board[16], 1);
  assert.equal((await call('room', 101, { type: 'color', side: 1 }))[0], 409);
  assert.equal((await call('room', 202, { type: 'v-mode', enabled: true }))[0], 400);
  assert.equal((await call('room', 101, { type: 'v-mode', enabled: true }))[1].management.vMode, true);
  assert.equal((await call('room', 101, { type: 'v-move', cells: [18, 18] }))[0], 400);
  const [, pair] = await call('room', 101, { type: 'v-move', cells: [17, 18] });
  assert.deepEqual(pair.board.slice(16, 19), [1, 2, 2]);
  assert.equal(pair.turn, 1);
  assert.equal((await call('room', 202))[1].management, undefined);
  const [, outOfTurn] = await call('room', 101, { type: 'v-move', cells: [19, 20] });
  assert.deepEqual(outOfTurn.board.slice(19, 21), [2, 2]);

  const [status, practice] = await call('practice', 202, { type: 'start', side: 2 });
  assert.equal(status, 200);
  assert.equal(practice.side, 2);
  assert.equal(practice.last, null);
  assert.equal((await call('practice', 101))[1].joined, false);
  assert.equal((await call('room', 202))[1].board[16], 1);
  assert.equal((await call('practice', 202, { type: 'start', side: 1 }))[1].side, 1);
  assert.equal((await call('practice', 202, { type: 'move', x: 2, y: 2 }))[1].board[32], 1);
});

test('a verified opposing VCF pauses AI and is visible to the owner only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gomoku-vcf-'));
  const stateFile = join(directory, 'state.json');
  const board = Array(225).fill(0);
  for (const index of [110, 111, 112, 113]) board[index] = 2;
  await writeFile(stateFile, JSON.stringify({
    version: 1, owner: '101', allowed: ['202'], selected: '202',
    rooms: { '202': { board, joined: true, ai: true, aiSide: 1, dueAt: Date.now(), turn: 1, result: 0, last: 113 } },
  }), { mode: 0o600 });
  const server = makeServer({ token, owner: '101', stateFile }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await once(server, 'listening');
  const call = async id => (await fetch(`http://127.0.0.1:${server.address().port}/api/room`, {
    headers: { 'X-Telegram-Init-Data': signed(id) },
  })).json();
  let owner = await call(101);
  for (let attempt = 0; attempt < 20 && owner.management.ai; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 15));
    owner = await call(101);
  }
  assert.equal(owner.management.ai, false);
  assert.deepEqual(owner.board, board);
  assert.equal(owner.management.analysis.afterMove, true);
  assert.equal(owner.management.analysis.line.length, 2);
  assert.equal((await call(202)).management, undefined);
});

test('estate dice settings are owner-only, isolated, and consumed by one owner roll', async t => {
  const server = makeServer({ token, owner: '101', allowed: ['202', '303'] }).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const address = `http://127.0.0.1:${server.address().port}`;
  async function send(id, body, path = 'estate') {
    const res = await fetch(address + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: id ? { 'X-Telegram-Init-Data': signed(id) } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return [res.status, path === 'estate' ? await res.json() : await res.text()];
  }
  assert.equal((await send(null, null, 'estate-admin'))[0], 401);
  assert.equal((await send(202, null, 'estate-admin'))[0], 403);
  assert.match((await send(101, null, 'estate-admin'))[1], /设置点数/);
  await send(101, { type: 'select', id: '202' });
  const [, joined] = await send(202, { type: 'join' });
  assert.equal(joined.side, 1);
  assert.equal(joined.management, undefined);
  assert.equal((await send(202, { type: 'set-die', value: 6 }))[0], 400);
  assert.equal((await send(101, { type: 'set-die', value: 7, opponent: '202' }))[0], 400);
  const [, staged] = await send(101, { type: 'set-die', value: 3, opponent: '202' });
  assert.equal(staged.management.nextDie, 3);
  assert.equal((await send(303))[1].joined, false);
  const [, visible] = await send(202);
  assert.equal(visible.management, undefined);
  assert.equal(visible.game.die, null);
  assert.equal((await send(202, { type: 'roll', revision: joined.revision }))[0], 409);
  const [, rolled] = await send(101, { type: 'roll', opponent: '202', revision: joined.revision, value: 6 });
  assert.equal(rolled.game.die, 3);
  assert.equal(rolled.game.players[0].at, 3);
  assert.equal(rolled.management.nextDie, null);
  assert.equal((await send(101, { type: 'roll', opponent: '202', revision: joined.revision }))[0], 409);
  const [, guest] = await send(202);
  assert.deepEqual(guest.game, rolled.game);
  assert(!Object.hasOwn(guest, 'management'));
});
