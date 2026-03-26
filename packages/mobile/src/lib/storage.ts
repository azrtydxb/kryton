import * as SecureStore from "expo-secure-store";

const KEYS = {
  serverUrl: "mnemo_server_url",
  apiKey: "mnemo_api_key",
  lastSyncAt: "mnemo_last_sync_at",
};

export const storage = {
  getServerUrl: () => SecureStore.getItemAsync(KEYS.serverUrl),
  setServerUrl: (url: string) => SecureStore.setItemAsync(KEYS.serverUrl, url),
  getApiKey: () => SecureStore.getItemAsync(KEYS.apiKey),
  setApiKey: (key: string) => SecureStore.setItemAsync(KEYS.apiKey, key),
  clearAuth: async () => {
    await SecureStore.deleteItemAsync(KEYS.apiKey);
  },
  getLastSyncAt: async () => {
    const val = await SecureStore.getItemAsync(KEYS.lastSyncAt);
    return val ? parseInt(val, 10) : 0;
  },
  setLastSyncAt: (ts: number) =>
    SecureStore.setItemAsync(KEYS.lastSyncAt, String(ts)),
};
