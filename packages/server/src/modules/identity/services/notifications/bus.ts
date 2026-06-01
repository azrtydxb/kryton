import { EventEmitter } from "node:events";

export interface NotificationEvent {
  id: string;
  userId: string;
  kind: "share-invite" | "mention" | "deadline" | "custom";
  title: string;
  body: string;
  createdAt: string;
  deepLink?: string;
}

export type Subscriber = (event: NotificationEvent) => void;

export class NotificationBus {
  private readonly emitter = new EventEmitter();
  private readonly afterPublishHooks: Array<(e: NotificationEvent) => Promise<void> | void> = [];

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  subscribe(userId: string, fn: Subscriber): () => void {
    this.emitter.on(userId, fn);
    return () => this.emitter.off(userId, fn);
  }

  async publish(event: NotificationEvent): Promise<void> {
    this.emitter.emit(event.userId, event);
    for (const hook of this.afterPublishHooks) {
      await hook(event);
    }
  }

  onAfterPublish(hook: (e: NotificationEvent) => Promise<void> | void): () => void {
    this.afterPublishHooks.push(hook);
    return () => {
      const i = this.afterPublishHooks.indexOf(hook);
      if (i >= 0) this.afterPublishHooks.splice(i, 1);
    };
  }
}

export const notificationBus = new NotificationBus();
