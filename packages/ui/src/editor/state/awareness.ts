// packages/ui/src/editor/state/awareness.ts
import type { Awareness } from "y-protocols/awareness";
import type { Selection } from "./types";

/**
 * Kind tag carried in awareness so the presence UI can distinguish human
 * collaborators from AI agents and render the appropriate badge / color
 * palette. Humans get cool-tone colors and no badge; agents get warm
 * tones and an "AI" pill on their cursor label + avatar.
 */
export type AwarenessKind = "user" | "agent";

export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
  kind: AwarenessKind;
}

export interface RemoteCursor {
  clientId: number;
  user: AwarenessUser;
  /** Cursor is optional — agent presence pills publish a `user` field with
   *  no cursor when they emit a transient edit notification. */
  cursor?: Selection;
}

export interface CursorAwareness {
  publish(selection: Selection): void;
  remotes(): RemoteCursor[];
  onChange(cb: () => void): () => void;
  dispose(): void;
}

export interface CreateCursorAwarenessOptions {
  kind?: AwarenessKind;
}

export function createCursorAwareness(
  awareness: Awareness,
  userId: string,
  userName: string,
  userColor: string,
  options: CreateCursorAwarenessOptions = {},
): CursorAwareness {
  const kind: AwarenessKind = options.kind ?? "user";
  const localUser: AwarenessUser = { id: userId, name: userName, color: userColor, kind };
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
        if (!state || !state.user) continue;
        const rawUser = state.user as Partial<AwarenessUser>;
        if (typeof rawUser.id !== "string" || typeof rawUser.name !== "string" || typeof rawUser.color !== "string") {
          continue;
        }
        const remoteKind: AwarenessKind = rawUser.kind === "agent" ? "agent" : "user";
        const user: AwarenessUser = {
          id: rawUser.id,
          name: rawUser.name,
          color: rawUser.color,
          kind: remoteKind,
        };
        const rawCursor = state.cursor as Partial<Selection> | undefined;
        const cursor: Selection | undefined =
          rawCursor && typeof rawCursor.anchor === "number" && typeof rawCursor.head === "number"
            ? { anchor: rawCursor.anchor, head: rawCursor.head }
            : undefined;
        out.push({ clientId, user, cursor });
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
