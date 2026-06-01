import type { NotificationEvent } from "../notifications/bus.js";
import type { ApnsResult } from "./apns.js";
import type { FcmResult } from "./fcm.js";

export interface DispatcherDeps {
  sendApns: (payload: {
    token: string;
    title: string;
    body: string;
    deepLink?: string;
    eventId?: string;
  }) => Promise<ApnsResult>;
  sendFcm: (payload: {
    token: string;
    title: string;
    body: string;
    deepLink?: string;
    eventId?: string;
  }) => Promise<FcmResult>;
  listDevices: (userId: string) => Promise<Array<{ id: string; platform: "ios" | "android"; token: string }>>;
  prune: (deviceId: string) => Promise<void>;
}

export async function dispatchPush(event: NotificationEvent, deps: DispatcherDeps): Promise<void> {
  const devices = await deps.listDevices(event.userId);
  await Promise.all(
    devices.map(async (d) => {
      const payload = {
        token: d.token,
        title: event.title,
        body: event.body,
        deepLink: event.deepLink,
        eventId: event.id,
      };
      const result =
        d.platform === "ios" ? await deps.sendApns(payload) : await deps.sendFcm(payload);
      if (!result.ok && result.permanent) await deps.prune(d.id);
    }),
  );
}
