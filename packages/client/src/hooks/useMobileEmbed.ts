import { useSyncExternalStore } from "react";

function read(): boolean {
  const v = new URLSearchParams(window.location.search).get("mobile");
  return v === "1" || v === "true";
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

/** True when the page is loaded inside the Kryton mobile webview (?mobile=1). */
export function useMobileEmbed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
