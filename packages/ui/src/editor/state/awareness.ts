// packages/ui/src/editor/state/awareness.ts
import type { Awareness } from "y-protocols/awareness";
import type { Selection } from "./types";

export interface RemoteCursor {
  clientId: number;
  user: { id: string; name: string; color: string };
  cursor: Selection;
}

export interface CursorAwareness {
  publish(selection: Selection): void;
  remotes(): RemoteCursor[];
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export function createCursorAwareness(
  awareness: Awareness, userId: string, userName: string, userColor: string,
): CursorAwareness {
  const localUser = { id: userId, name: userName, color: userColor };
  awareness.setLocalStateField("user", localUser);

  const subs = new Set<() => void>();
  const onUpdate = () => subs.forEach((cb) => cb());
  awareness.on("update", onUpdate);

  return {
    publish(selection) {
      awareness.setLocalStateField("cursor", selection);
    },
    remotes() {
      const out: RemoteCursor[] = [];
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        if (!state || !state.user || !state.cursor) continue;
        out.push({ clientId, user: state.user, cursor: state.cursor });
      }
      return out;
    },
    onChange(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    dispose() {
      awareness.off("update", onUpdate);
      subs.clear();
    },
  };
}
