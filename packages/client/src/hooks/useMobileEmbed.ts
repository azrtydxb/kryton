import { useSyncExternalStore } from "react";

// Cache the first detection for the whole session. The app's URL sync rewrites
// the URL via history.pushState and may drop the `?mobile=` param, so re-reading
// later would incorrectly return false. Once embedded, always embedded.
let cached: boolean | null = null;

function read(): boolean {
  if (cached !== null) return cached;
  const v = new URLSearchParams(window.location.search).get("mobile");
  cached = v === "1" || v === "true";
  return cached;
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

/** True when the page is loaded inside the Kryton mobile webview (?mobile=1). */
export function useMobileEmbed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
