import { synchronize } from "@nozbe/watermelondb/sync";
import { database } from "./index";
import { api } from "../lib/api";

export async function syncWithServer(): Promise<void> {
  await synchronize({
    database,
    pullChanges: async ({ lastPulledAt }) => {
      const response = await api.syncPull(lastPulledAt || 0);
      return { changes: response.changes, timestamp: response.timestamp };
    },
    pushChanges: async ({ changes, lastPulledAt }) => {
      await api.syncPush(changes, lastPulledAt || 0);
    },
    migrationsEnabledAtVersion: 1,
  });
}
