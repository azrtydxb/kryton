import { PluginEvent, PluginEventHandler } from "./types";

interface HandlerEntry {
  handler: PluginEventHandler;
  pluginId: string | null;
}

export class PluginEventBus {
  private handlers = new Map<PluginEvent, HandlerEntry[]>();

  on(event: PluginEvent, handler: PluginEventHandler, pluginId?: string): void {
    const entries = this.handlers.get(event) || [];
    entries.push({ handler, pluginId: pluginId ?? null });
    this.handlers.set(event, entries);
  }

  off(event: PluginEvent, handler: PluginEventHandler): void {
    const entries = this.handlers.get(event);
    if (!entries) return;
    this.handlers.set(
      event,
      entries.filter((e) => e.handler !== handler)
    );
  }

  async emit(event: PluginEvent, ...args: unknown[]): Promise<void> {
    const entries = this.handlers.get(event) || [];
    for (const entry of entries) {
      try {
        await entry.handler(...args);
      } catch {
        // after-events are fire-and-forget; errors are swallowed
      }
    }
  }

  async emitBefore(event: PluginEvent, ...args: unknown[]): Promise<void> {
    const entries = this.handlers.get(event) || [];
    for (const entry of entries) {
      await entry.handler(...args);
      // If handler throws, it propagates (cancels the operation)
    }
  }

  removeAllForPlugin(pluginId: string): void {
    for (const [event, entries] of this.handlers) {
      this.handlers.set(
        event,
        entries.filter((e) => e.pluginId !== pluginId)
      );
    }
  }
}
