import { describe, it, expect, vi } from "vitest";
import { createVaultEventsRegistry, type BroadcastSocket } from "../index.js";
import type { VaultEvent } from "../types.js";

const WS_OPEN = 1;

function makeSocket(): BroadcastSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    readyState: WS_OPEN,
    OPEN: WS_OPEN,
    send(data: string) {
      sent.push(data);
    },
  };
}

function noteUpdated(overrides: Partial<VaultEvent> = {}): VaultEvent {
  return {
    kind: "note.updated",
    path: "Welcome.md",
    updatedAt: "2026-05-19T00:00:00.000Z",
    size: 12,
    clientId: null,
    agentId: null,
    agentName: null,
    ...overrides,
  } as VaultEvent;
}

describe("vault-events registry", () => {
  it("delivers an event to every socket of the target user", () => {
    const registry = createVaultEventsRegistry();
    const a = makeSocket();
    const b = makeSocket();
    registry.register("u1", a, "client-a");
    registry.register("u1", b, "client-b");

    const delivered = registry.emit("u1", noteUpdated());

    expect(delivered).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0])).toMatchObject({ kind: "note.updated", path: "Welcome.md" });
  });

  it("skips the originating socket when the clientId matches", () => {
    const registry = createVaultEventsRegistry();
    const origin = makeSocket();
    const peer = makeSocket();
    registry.register("u1", origin, "client-a");
    registry.register("u1", peer, "client-b");

    const delivered = registry.emit("u1", noteUpdated({ clientId: "client-a" }));

    expect(delivered).toBe(1);
    expect(origin.sent).toHaveLength(0);
    expect(peer.sent).toHaveLength(1);
  });

  it("does not cross-broadcast between users", () => {
    const registry = createVaultEventsRegistry();
    const owner = makeSocket();
    const other = makeSocket();
    registry.register("u1", owner, null);
    registry.register("u2", other, null);

    registry.emit("u1", noteUpdated());

    expect(owner.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
  });

  it("skips sockets whose readyState is not OPEN", () => {
    const registry = createVaultEventsRegistry();
    const closing = makeSocket();
    closing.readyState = 2; // CLOSING
    const open = makeSocket();
    registry.register("u1", closing, null);
    registry.register("u1", open, null);

    const delivered = registry.emit("u1", noteUpdated());

    expect(delivered).toBe(1);
    expect(closing.sent).toHaveLength(0);
    expect(open.sent).toHaveLength(1);
  });

  it("dispose() removes the socket so future events skip it", () => {
    const registry = createVaultEventsRegistry();
    const s = makeSocket();
    const dispose = registry.register("u1", s, null);

    expect(registry.socketCount("u1")).toBe(1);
    dispose();
    expect(registry.socketCount("u1")).toBe(0);

    const delivered = registry.emit("u1", noteUpdated());
    expect(delivered).toBe(0);
    expect(s.sent).toHaveLength(0);
  });

  it("routes send() errors through the onSendError hook without throwing", () => {
    const onSendError = vi.fn();
    const registry = createVaultEventsRegistry({ onSendError });
    const flaky: BroadcastSocket = {
      readyState: WS_OPEN,
      OPEN: WS_OPEN,
      send: () => {
        throw new Error("boom");
      },
    };
    registry.register("u1", flaky, null);

    expect(() => registry.emit("u1", noteUpdated())).not.toThrow();
    expect(onSendError).toHaveBeenCalledTimes(1);
    expect(onSendError.mock.calls[0][1]).toBe("u1");
  });

  it("emits all VaultEvent kinds (smoke check on payload shape)", () => {
    const registry = createVaultEventsRegistry();
    const s = makeSocket();
    registry.register("u1", s, null);

    const events: VaultEvent[] = [
      { kind: "note.created", path: "a.md", updatedAt: "x", size: 0, clientId: null, agentId: null, agentName: null },
      { kind: "note.updated", path: "a.md", updatedAt: "x", size: 0, clientId: null, agentId: null, agentName: null },
      { kind: "note.deleted", path: "a.md", clientId: null, agentId: null, agentName: null },
      { kind: "note.renamed", from: "a.md", to: "b.md", updatedAt: "x", size: 0, clientId: null, agentId: null, agentName: null },
      { kind: "note.moved", from: "a.md", to: "f/a.md", updatedAt: "x", size: 0, clientId: null, agentId: null, agentName: null },
      { kind: "folder.created", path: "f", clientId: null, agentId: null, agentName: null },
      { kind: "folder.deleted", path: "f", clientId: null, agentId: null, agentName: null },
      { kind: "folder.renamed", from: "f", to: "g", clientId: null, agentId: null, agentName: null },
      { kind: "tag.added", tag: "todo", path: "a.md", clientId: null, agentId: null, agentName: null },
      { kind: "tag.removed", tag: "todo", path: "a.md", clientId: null, agentId: null, agentName: null },
    ];

    for (const ev of events) registry.emit("u1", ev);
    expect(s.sent).toHaveLength(events.length);
    const decoded = s.sent.map((s) => JSON.parse(s).kind);
    expect(decoded).toEqual(events.map((e) => e.kind));
  });

  it("agent attribution propagates through to the wire payload", () => {
    const registry = createVaultEventsRegistry();
    const s = makeSocket();
    registry.register("u1", s, null);

    registry.emit("u1", noteUpdated({ agentId: "ag-1", agentName: "Claude" }));

    const payload = JSON.parse(s.sent[0]);
    expect(payload.agentId).toBe("ag-1");
    expect(payload.agentName).toBe("Claude");
  });
});
