import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
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
    const res = await fetch(address + '/api/room', {
      method: body ? 'POST' : 'GET',
      headers: id ? { 'X-Telegram-Init-Data': signed(id) } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return [res.status, await res.json()];
  }
  const move = (id, x, y) => call(id, {type:'move', x, y});
  assert.equal((await fetch(address)).status, 200);
  assert.equal((await call(null))[0], 401);
  assert.equal((await call(404))[0], 403);
  assert.equal((await move(101,0,0))[0], 409);
  assert.equal((await call(202,{type:'join'}))[1].side, 2);
  assert.equal((await call(303,{type:'join'}))[0], 409);
  assert.deepEqual((await call(303))[1].board, []);
  assert.equal((await move(202,0,1))[0], 409);
  for (let x = 0; x < 4; x++) {
    assert.equal((await move(101,x,0))[0], 200);
    assert.equal((await move(202,x,0))[0], 409);
    assert.equal((await move(202,x,1))[0], 200);
  }
  const [status, state] = await move(101,4,0);
  assert.equal(status, 200);
  assert.equal(state.result, 1);
  assert.equal((await move(202,4,1))[0], 409);
  assert.equal((await call(202,{type:'reset'}))[0], 400);
  const [, reset] = await call(101,{type:'reset'});
  assert.equal(reset.joined, false);
  assert(reset.board.every(stone => stone === 0));
});
