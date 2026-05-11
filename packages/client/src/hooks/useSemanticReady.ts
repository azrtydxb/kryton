import { useState, useEffect } from "react";
import type { SemanticReady } from "../lib/api";

/**
 * Polls /api/search/semantic/ready while `enabled` is true.
 *
 * Interval strategy:
 * - 2s while the embedder is warming up (`!ready`)
 * - 5s while ready but jobs are pending (`pendingJobs > 0`)
 * - 30s while ready + idle (cheap heartbeat, mostly to notice when new
 *   notes get enqueued)
 *
 * The IIFE pattern inside the effect satisfies the
 * `react-hooks/set-state-in-effect` rule (pinned to 7.1.1).
 */
export function useSemanticReady(enabled: boolean): SemanticReady | null {
  const [state, setState] = useState<SemanticReady | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/search/semantic/ready", {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) {
            timer = setTimeout(() => {
              void poll();
            }, 5000);
          }
          return;
        }
        const data = (await res.json()) as SemanticReady;
        if (cancelled) return;
        setState(data);
        const next = !data.ready ? 2000 : data.pendingJobs > 0 ? 5000 : 30_000;
        timer = setTimeout(() => {
          void poll();
        }, next);
      } catch {
        if (!cancelled) {
          timer = setTimeout(() => {
            void poll();
          }, 5000);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return enabled ? state : null;
}
