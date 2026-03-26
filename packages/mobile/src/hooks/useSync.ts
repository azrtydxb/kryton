import { useState, useEffect, useCallback } from "react";
import { syncWithServer } from "../db/sync";

export interface SyncState {
  syncing: boolean;
  lastSyncAt: Date | null;
  error: string | null;
}

export interface SyncActions {
  sync: () => Promise<void>;
}

export type UseSyncReturn = SyncState & SyncActions;

export function useSync(): UseSyncReturn {
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await syncWithServer();
      setLastSyncAt(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      setError(message);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // Auto-sync on mount
  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { syncing, lastSyncAt, error, sync };
}
