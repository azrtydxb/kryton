// packages/core-react/src/provider.tsx
import { createContext, useContext, type ReactNode } from "react";

/**
 * Minimal structural type for the Kryton instance.
 * When @azrtydxb/core exports `Kryton`, consumers may cast:
 *   <KrytonProvider core={krytonInstance as KrytonInstance}>
 * At merge time, 2A will export the real Kryton class and this can be
 * narrowed to `import type { Kryton } from "@azrtydxb/core"`.
 */
export interface KrytonInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

const Ctx = createContext<KrytonInstance | null>(null);

export function KrytonProvider({
  core,
  children,
}: {
  core: KrytonInstance;
  children: ReactNode;
}) {
  return <Ctx.Provider value={core}>{children}</Ctx.Provider>;
}

export function useKryton(): KrytonInstance {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKryton must be used within KrytonProvider");
  return v;
}
