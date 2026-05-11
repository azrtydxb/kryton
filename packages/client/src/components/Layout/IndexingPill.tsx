/**
 * IndexingPill — small accent-soft chip in the header that surfaces
 * "N indexing" while `pendingJobs > 0` on /api/search/semantic/ready.
 *
 * Polling cadence:
 *   - 5 s while there's active indexing work (pendingJobs > 0)
 *   - 30 s while idle (pendingJobs = 0)
 *   - 30 s back-off on 401 (signed-out) and any network/5xx error
 *
 * Render: returns null when state is unloaded or pendingJobs === 0,
 * so the pill is genuinely default-hidden — no "0 indexing" flash.
 */
import { useState, useEffect, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';

interface SemanticReady {
  ready: boolean;
  pendingJobs: number;
}

export function IndexingPill(): ReactElement | null {
  const [state, setState] = useState<SemanticReady | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/search/semantic/ready', { credentials: 'include' });
        if (!res.ok) {
          // 401 (not signed in) or 5xx — back off, leave any prior state alone.
          if (!cancelled) timer = setTimeout(() => { void poll(); }, 30_000);
          return;
        }
        const data = (await res.json()) as SemanticReady;
        if (cancelled) return;
        setState(data);
        const next = data.pendingJobs > 0 ? 5_000 : 30_000;
        timer = setTimeout(() => { void poll(); }, next);
      } catch {
        if (!cancelled) timer = setTimeout(() => { void poll(); }, 30_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!state || state.pendingJobs === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      title={`${state.pendingJobs} note(s) are being indexed for semantic search`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 5,
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
      }}
    >
      <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
      <span>{state.pendingJobs} indexing</span>
    </div>
  );
}
