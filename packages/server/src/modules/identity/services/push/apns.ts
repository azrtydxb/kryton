import { Notification, Provider } from "@parse/node-apn";

export interface ApnsPayload {
  token: string;
  title: string;
  body: string;
  deepLink?: string;
  /** Opaque event ID, deduped client-side against the SSE stream. */
  eventId?: string;
}

export type ApnsResult =
  | { ok: true }
  | { ok: false; permanent: boolean; reason: string };

export interface ApnsDeps {
  provider: Pick<Provider, "send">;
  bundleId: string;
}

const PERMANENT_REASONS = new Set([
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "BadCertificate",
  "BadCertificateEnvironment",
]);

export async function sendApns(payload: ApnsPayload, deps: ApnsDeps): Promise<ApnsResult> {
  const note = new Notification();
  note.topic = deps.bundleId;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  if (payload.deepLink) note.payload = { ...note.payload, deepLink: payload.deepLink };
  if (payload.eventId) note.payload = { ...note.payload, eventId: payload.eventId };

  let result: Awaited<ReturnType<Provider["send"]>>;
  try {
    result = await deps.provider.send(note, payload.token);
  } catch (err) {
    // The APNs client can throw on transient network/TLS errors. Map to a
    // transient failure (matching sendFcm) rather than letting it bubble up.
    return { ok: false, permanent: false, reason: err instanceof Error ? err.message : "send_threw" };
  }
  if (result.sent.length > 0) return { ok: true };
  const fail = result.failed[0];
  const reason = (fail?.response as { reason?: string } | undefined)?.reason ?? "Unknown";
  const permanent = PERMANENT_REASONS.has(reason) || fail?.status === 410;
  return { ok: false, permanent, reason };
}

let cachedProvider: Provider | null = null;
export function getDefaultProvider(opts: {
  keyPath: string;
  keyId: string;
  teamId: string;
  production: boolean;
}): Provider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = new Provider({
    token: { key: opts.keyPath, keyId: opts.keyId, teamId: opts.teamId },
    production: opts.production,
  });
  return cachedProvider;
}
