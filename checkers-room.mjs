import { initialCheckers, playCheckers, recommend } from './public/checkers-rules.mjs';

export function checkersRoom(store, id, owner, action) {
  const admin = id === owner;
  const state = action ? structuredClone(store.state) : store.state;
  let opponent = admin ? state.checkersOpponent : id;
  let hint = null;
  if (admin && action?.type === 'select') {
    if (!state.allowed.includes(action.id)) return [400, { error: '请先在五子棋管理员工具中授权该好友' }];
    opponent = state.checkersOpponent = action.id;
  }
  let game = state.checkers?.[opponent] ?? initialCheckers();
  let joined = Boolean(state.checkers?.[opponent]);
  if (action && !(admin && action.type === 'select')) {
    if (!opponent || (admin && action.opponent !== opponent)) return [409, { error: '对局已切换' }];
    if (!admin && action.type === 'join') {
      joined = true;
    } else if (admin && action.type === 'reset' && joined) {
      game = initialCheckers();
      joined = false;
    } else if (admin && action.type === 'hint' && joined && game.turn === 1) {
      hint = recommend(game)?.path ?? [];
    } else if (action.type === 'move' && joined && game.turn === (admin ? 1 : 2)) {
      const next = playCheckers(game, action.source, action.destination);
      if (!next) return [409, { error: '这一步不能走' }];
      game = next;
    } else {
      return [400, { error: '无效操作' }];
    }
    const rooms = state.checkers ??= {};
    if (joined) rooms[opponent] = game;
    else delete rooms[opponent];
  }
  if (action && action.type !== 'hint' && !store.commit(state)) return [503, { error: '暂时无法保存，请重试' }];
  return [200, {
    ...game, joined, side: admin ? 1 : joined ? 2 : 0,
    ...(admin && { management: { allowed: state.allowed, opponent: opponent ?? null, hint } }),
  }];
}
