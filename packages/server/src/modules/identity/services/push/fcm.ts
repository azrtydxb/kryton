import admin from "firebase-admin";

export interface FcmPayload {
  token: string;
  title: string;
  body: string;
  deepLink?: string;
  eventId?: string;
}

export type FcmResult =
  | { ok: true }
  | { ok: false; permanent: boolean; reason: string };

export interface FcmDeps {
  messaging: Pick<admin.messaging.Messaging, "send">;
}

const PERMANENT_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/mismatched-credential",
]);

export async function sendFcm(payload: FcmPayload, deps: FcmDeps): Promise<FcmResult> {
  try {
    await deps.messaging.send({
      token: payload.token,
      notification: { title: payload.title, body: payload.body },
      data: {
        ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
        ...(payload.eventId ? { eventId: payload.eventId } : {}),
      },
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "unknown";
    const permanent = PERMANENT_CODES.has(code);
    return { ok: false, permanent, reason: code };
  }
}

let cachedApp: admin.app.App | null = null;
export function getDefaultMessaging(opts: {
  serviceAccountPath: string;
  projectId: string;
}): admin.messaging.Messaging {
  if (!cachedApp) {
    cachedApp = admin.initializeApp({
      credential: admin.credential.cert(opts.serviceAccountPath),
      projectId: opts.projectId,
    });
  }
  return cachedApp.messaging();
}
