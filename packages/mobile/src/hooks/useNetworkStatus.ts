import { useState, useEffect } from "react";
import * as Network from "expo-network";

export interface NetworkStatus {
  isOnline: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkNetwork() {
      try {
        const state = await Network.getNetworkStateAsync();
        if (!cancelled) {
          setIsOnline(state.isInternetReachable === true);
        }
      } catch {
        // Default to online if check fails
      }
    }

    checkNetwork();

    // Poll every 10 seconds
    const interval = setInterval(checkNetwork, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { isOnline };
}
