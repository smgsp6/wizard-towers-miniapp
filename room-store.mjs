import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function roomStore(file, owner, allowed) {
  let state = { version: 1, owner, allowed: [...new Set(allowed)].filter(id => id !== owner), selected: null, rooms: {} };
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || saved.owner !== owner || !Array.isArray(saved.allowed) ||
          !saved.rooms || typeof saved.rooms !== 'object') throw new Error();
      state = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('无法读取对局存档，请检查私有目录和备份。');
    }
  }
  return {
    get state() { return state; },
    commit(next) {
      if (file) {
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
          writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx', flush: true });
          renameSync(temporary, file);
        } catch {
          try { unlinkSync(temporary); } catch {}
          return false;
        }
      }
      state = next;
      return true;
    },
  };
}
