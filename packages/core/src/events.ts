// packages/core/src/events.ts
type Handler<T> = (payload: T) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventBus<E extends Record<string, any> = Record<string, any>> {
  private handlers = new Map<keyof E, Set<Handler<unknown>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler as Handler<unknown>);
    return () => set!.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try { (h as Handler<E[K]>)(payload); }
      catch (e) { console.error(`[EventBus] handler error for ${String(event)}`, e); }
    }
  }
}
