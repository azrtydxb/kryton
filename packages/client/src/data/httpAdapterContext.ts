import { createContext, useContext } from "react";
import { HttpAdapter } from "./HttpAdapter";

/**
 * React context exposing the underlying `HttpAdapter` instance so hooks
 * that need methods outside the generic `KrytonDataAdapter` surface
 * (e.g. `useVaultEvents` calling `applyVaultEvent`) can reach it
 * without prop-drilling.
 */
export const HttpAdapterContext = createContext<HttpAdapter | null>(null);

export function useHttpAdapter(): HttpAdapter {
  const adapter = useContext(HttpAdapterContext);
  if (!adapter) {
    throw new Error("useHttpAdapter must be used inside <HttpDataProvider>");
  }
  return adapter;
}
