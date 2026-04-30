// packages/core/src/sync/http.ts
import type { PullResponse, PushRequest, PushResponse, VersionResponse } from "./protocol";
import { KrytonAuthError, KrytonSyncError } from "../errors";

export interface HttpSyncClientOpts {
  serverUrl: string;
  authToken: () => string | null | Promise<string | null>;
  fetch?: typeof fetch;
}

export class HttpSyncClient {
  private serverUrl: string;
  private authToken: HttpSyncClientOpts["authToken"];
  private fetchImpl: typeof fetch;

  constructor(opts: HttpSyncClientOpts) {
    this.serverUrl = opts.serverUrl.replace(/\/+$/, "");
    this.authToken = opts.authToken;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async req<T>(path: string, body: unknown): Promise<T> {
    const tok = await this.authToken();
    const res = await this.fetchImpl(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tok ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      throw new KrytonAuthError(`${res.status} on ${path}`);
    }
    if (!res.ok) {
      const txt = await (res as any).text().catch(() => "");
      throw new KrytonSyncError(`${res.status} on ${path}: ${txt}`, {
        retryable: res.status >= 500 && res.status < 600,
      });
    }
    return res.json() as Promise<T>;
  }

  async pull(cursor: string): Promise<PullResponse> {
    return this.req<PullResponse>("/api/sync/v2/pull", { cursor });
  }

  async push(req: PushRequest): Promise<PushResponse> {
    return this.req<PushResponse>("/api/sync/v2/push", req);
  }

  async version(): Promise<VersionResponse> {
    const res = await this.fetchImpl(`${this.serverUrl}/api/version`);
    if (!res.ok) throw new KrytonSyncError(`version probe failed`, { retryable: true });
    return res.json() as Promise<VersionResponse>;
  }
}
