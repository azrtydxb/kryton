/**
 * HttpDataProvider — wraps HttpAdapter in <KrytonDataProvider> and triggers
 * an initial full refresh on mount.
 *
 * Usage:
 *   const adapter = new HttpAdapter({ baseUrl: "" });
 *   <HttpDataProvider adapter={adapter}>...</HttpDataProvider>
 */

import { useEffect, type ReactNode } from "react";
import { KrytonDataProvider } from "@azrtydxb/ui";
import { HttpAdapter } from "./HttpAdapter";

interface HttpDataProviderProps {
  adapter: HttpAdapter;
  children: ReactNode;
}

export function HttpDataProvider({ adapter, children }: HttpDataProviderProps) {
  useEffect(() => {
    // Prime all caches on mount. Errors are non-fatal — UI will just show empty state.
    const entityTypes = [
      "notes",
      "tags",
      "settings",
      "noteShares",
      "trashItems",
      "currentUser",
    ] as const;

    for (const entityType of entityTypes) {
      adapter.refresh(entityType).catch((err: unknown) => {
        console.warn(`[HttpDataProvider] initial refresh(${entityType}) failed:`, err);
      });
    }
   
  }, [adapter]);

  return <KrytonDataProvider adapter={adapter}>{children}</KrytonDataProvider>;
}
