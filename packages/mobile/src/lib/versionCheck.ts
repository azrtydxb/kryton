import { api, ServerVersionInfo } from "./api";
import { APP_MAJOR_VERSION, APP_VERSION } from "./version";

export interface VersionCheckResult {
  compatible: boolean;
  serverVersion?: string;
  serverMajor?: number;
  clientVersion: string;
  clientMajor: number;
  message?: string;
}

export async function checkVersionCompatibility(): Promise<VersionCheckResult> {
  let serverInfo: ServerVersionInfo;
  try {
    serverInfo = await api.getServerVersion();
  } catch {
    // If the endpoint doesn't exist (old server), skip the check
    return {
      compatible: true,
      clientVersion: APP_VERSION,
      clientMajor: APP_MAJOR_VERSION,
    };
  }

  const compatible = serverInfo.majorVersion === APP_MAJOR_VERSION;

  if (compatible) {
    return {
      compatible: true,
      serverVersion: serverInfo.version,
      serverMajor: serverInfo.majorVersion,
      clientVersion: APP_VERSION,
      clientMajor: APP_MAJOR_VERSION,
    };
  }

  const message =
    serverInfo.majorVersion > APP_MAJOR_VERSION
      ? `Server version (v${serverInfo.version}) is incompatible with this app (v${APP_VERSION}). Please update your app.`
      : `Server version (v${serverInfo.version}) is incompatible with this app (v${APP_VERSION}). Please contact your admin to update the server.`;

  return {
    compatible: false,
    serverVersion: serverInfo.version,
    serverMajor: serverInfo.majorVersion,
    clientVersion: APP_VERSION,
    clientMajor: APP_MAJOR_VERSION,
    message,
  };
}
