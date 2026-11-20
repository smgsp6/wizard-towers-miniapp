import { randomInt } from 'node:crypto';
import { estateAction, initialEstate } from './public/estate.mjs';

export function estateRoom(store, id, owner, action) {
  const admin = id === owner;
  const state = action ? structuredClone(store.state) : store.state;
  let opponent = admin ? state.estateOpponent : id;
  if (admin && action?.type === 'select') {
    if (!state.allowed.includes(action.id)) return [400, { error: '请先授权该好友' }];
    opponent = state.estateOpponent = action.id;
  }
  let room = state.estate?.[opponent] ?? null;
  if (action && !(admin && action.type === 'select')) {
    if (!opponent || (admin && action.opponent !== opponent)) return [409, { error: '对局已切换' }];
    const rooms = state.estate ??= {};
    const type = action.type;
    if (type === 'join' && !admin) {
      room ??= { game: initialEstate(), nextDie: null, revision: randomInt(1, 2 ** 47) };
    } else if (type === 'reset' && admin && room && action.revision === room.revision) {
      room = null;
    } else if (type === 'set-die' && admin && room) {
      const { value } = action;
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 6)) return [400, { error: '请输入 1 到 6 的整数' }];
      room.nextDie = value;
    } else if (room && ['roll','buy','skip','upgrade','boost','shield','audit','sell','release','wait','fly','stay'].includes(type)) {
      if (room.game.turn !== (admin ? 0 : 1) || action.revision !== room.revision) return [409, { error: '局面已变动，请重试' }];
      const point = type === 'roll' ? (admin && room.nextDie) || randomInt(1, 7) : 0;
      const next = estateAction(room.game, type, point, action.target);
      if (next === room.game) return [409, { error: '当前不能执行这个操作' }];
      room.game = next;
      room.revision++;
      if (admin && type === 'roll') room.nextDie = null;
    } else {
      return [400, { error: '无效操作' }];
    }
    if (room) rooms[opponent] = room;
    else delete rooms[opponent];
  }
  if (action && !store.commit(state)) return [503, { error: '暂时无法保存，请重试' }];
  return [200, {
    game: room?.game ?? initialEstate(), joined: Boolean(room), side: admin ? 0 : room ? 1 : null,
    revision: room?.revision ?? null,
    ...(admin && { management: { allowed: state.allowed, opponent: opponent ?? null, nextDie: room?.nextDie ?? null } }),
  }];
}
