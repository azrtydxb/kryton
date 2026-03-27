let _activeNotePath: string | null = null;
const _listeners: Array<(path: string | null) => void> = [];

export const activeNoteStore = {
  get: () => _activeNotePath,
  set: (path: string | null) => {
    _activeNotePath = path;
    _listeners.forEach((fn) => fn(path));
  },
  subscribe: (fn: (path: string | null) => void) => {
    _listeners.push(fn);
    return () => {
      const idx = _listeners.indexOf(fn);
      if (idx >= 0) _listeners.splice(idx, 1);
    };
  },
};
