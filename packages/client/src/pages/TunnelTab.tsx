/**
 * Tunnel admin tab — pasted into AdminPage's tab list.
 *
 * Surfaces the state of the reverse-tunnel client (which dials out to
 * tunnel.kryton.ai), lets an admin paste/rotate/clear the JWT, and
 * shows a small traffic widget.
 *
 * See docs/superpowers/specs/2026-05-12-kryton-tunnel-client-design.md §5.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import {
  Globe, Loader2, AlertTriangle, ShieldOff, CheckCircle2,
  XCircle, RefreshCw, Trash2, Copy, ExternalLink,
} from 'lucide-react';

import { request } from '../lib/api';
import { Section, Field } from '../components/Settings/settings-kit';
import {
  helpText, inputStyle as kitInputStyle, primaryBtn, ghostBtn, dangerBtn,
} from '../components/Settings/settings-kit-styles';

// ─────────────────────────── types ───────────────────────────

type FatalReason =
  | 'invalid-jwt' | 'revoked-jwt' | 'subscription-inactive'
  | 'duplicate-instance' | 'unknown';

type TunnelStatus =
  | { state: 'idle'; message: string }
  | { state: 'connecting' }
  | { state: 'open'; subdomain: string; sessionId: string; connectedAt: number; tokenExpiresAt: number }
  | { state: 'backoff'; nextAttemptAt: number; lastError: string }
  | { state: 'fatal'; reason: FatalReason; message: string }
  | { state: 'closing' };

interface TunnelStats {
  window: '24h' | '7d' | '30d';
  requests: number;
  bytes_in: number;
  bytes_out: number;
  daily: { date: string; requests: number; bytes_in: number; bytes_out: number }[];
  since: number;
}

const KRYTON_AI_DASHBOARD = 'https://kryton.ai/tunnels/dashboard';

// ─────────────────────────── helpers ───────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function StatusBadge({ status }: { status: TunnelStatus | null }) {
  const variants: Record<string, { color: string; label: string; icon: typeof Globe }> = {
    idle:        { color: 'var(--fg-3)',         label: 'Not configured',  icon: ShieldOff },
    connecting:  { color: 'var(--accent-warn)',  label: 'Connecting',      icon: Loader2 },
    open:        { color: 'var(--accent-good)',  label: 'Connected',       icon: CheckCircle2 },
    backoff:     { color: 'var(--accent-warn)',  label: 'Reconnecting',    icon: RefreshCw },
    fatal:       { color: 'var(--accent-danger)', label: 'Disconnected',    icon: XCircle },
    closing:     { color: 'var(--fg-3)',         label: 'Shutting down',   icon: ShieldOff },
  };
  const key = status?.state ?? 'idle';
  const v = variants[key];
  const Icon = v.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 999,
        background: 'color-mix(in oklch, var(--bg-2) 70%, transparent)',
        border: `1px solid color-mix(in oklch, ${v.color} 30%, transparent)`,
        color: v.color, fontSize: 13, fontWeight: 500,
      }}
    >
      <Icon size={13} style={{ animation: key === 'connecting' ? 'spin 1s linear infinite' : undefined }} />
      <span>{v.label}</span>
    </div>
  );
}

// ─────────────────────────── component ───────────────────────────

export function TunnelTab() {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [stats, setStats] = useState<TunnelStats | null>(null);
  const [statsWindow, setStatsWindow] = useState<'24h' | '7d' | '30d'>('24h');
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // `now` advances every second so render-pure children can compute
  // relative-time strings (token expiry, backoff countdown) without
  // calling Date.now during render.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const cancelled = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await request<TunnelStatus>('/admin/tunnel/status');
      if (!cancelled.current) setStatus(data);
    } catch (e: unknown) {
      if (!cancelled.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const fetchStats = useCallback(async (window: '24h' | '7d' | '30d') => {
    try {
      const data = await request<TunnelStats>(`/admin/tunnel/stats?window=${window}`);
      if (!cancelled.current) setStats(data);
    } catch {
      // stats failure is non-fatal for the page
    }
  }, []);

  // Status polling — 2s while transient, 5s when open, 10s otherwise.
  useEffect(() => {
    cancelled.current = false;
    void (async () => {
      await fetchStatus();
    })();
    const interval = (() => {
      if (!status) return 2_000;
      if (status.state === 'open') return 5_000;
      if (status.state === 'connecting' || status.state === 'backoff') return 2_000;
      return 10_000;
    })();
    const id = setInterval(() => {
      void (async () => {
        await fetchStatus();
      })();
    }, interval);
    return () => {
      cancelled.current = true;
      clearInterval(id);
    };
  }, [fetchStatus, status]);

  // Stats fetch on window change + on first load.
  useEffect(() => {
    void (async () => {
      await fetchStats(statsWindow);
    })();
    const id = setInterval(() => {
      void (async () => {
        await fetchStats(statsWindow);
      })();
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchStats, statsWindow]);

  const clearToken = useCallback(async () => {
    if (!confirm('Disconnect the tunnel? Your Kryton will no longer be reachable at its public URL.')) {
      return;
    }
    try {
      await request<null>('/admin/tunnel/token', { method: 'DELETE' });
      await fetchStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchStatus]);

  const reconnect = useCallback(async () => {
    try {
      await request<{ accepted: boolean }>('/admin/tunnel/reconnect', { method: 'POST' });
      await fetchStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchStatus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)',
            border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
            color: 'var(--accent-danger)', fontFamily: 'var(--font-mono)', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <Section title="Status">
        <StatusBlock status={status} now={now} onTryAgain={reconnect} />
      </Section>

      <Section title="Tunnel token">
        <TokenBlock
          status={status}
          onPaste={() => setPasteOpen(true)}
          onClear={clearToken}
        />
      </Section>

      <Section title="Traffic">
        <StatsBlock stats={stats} window={statsWindow} onWindowChange={setStatsWindow} />
      </Section>

      <Section title="Setup help">
        <p style={helpText}>
          When connected, your Kryton is reachable at{' '}
          <code>&lt;your-subdomain&gt;.my.kryton.ai</code>. Public traffic is
          routed through the central tunnel server; Kryton's own auth (login,
          API keys, 2FA, passkeys) governs who can access your data.
        </p>
        <p style={helpText}>
          Manage your subscription, rotate tokens, or rename your subdomain on{' '}
          <a
            href={KRYTON_AI_DASHBOARD}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            kryton.ai <ExternalLink size={12} style={{ display: 'inline', marginLeft: 2 }} />
          </a>.
        </p>
      </Section>

      {pasteOpen && (
        <PasteTokenDialog
          onClose={() => setPasteOpen(false)}
          onSaved={async () => {
            setPasteOpen(false);
            await fetchStatus();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── subcomponents ───────────────────────────

function StatusBlock({
  status,
  now,
  onTryAgain,
}: {
  status: TunnelStatus | null;
  now: number;
  onTryAgain: () => void;
}) {
  const row: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg-1)',
  };

  if (!status) {
    return (
      <div style={row}>
        <span style={helpText}>Loading…</span>
      </div>
    );
  }

  if (status.state === 'open') {
    const remainingDays = Math.max(0, Math.round((status.tokenExpiresAt - now) / 86_400));
    return (
      <div style={row}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StatusBadge status={status} />
            <span style={{ color: 'var(--fg)', fontWeight: 500 }}>
              <code>{status.subdomain}.my.kryton.ai</code>
            </span>
          </div>
          <span style={helpText}>
            Session {status.sessionId.slice(0, 8)}… · token expires in {remainingDays} days
          </span>
        </div>
      </div>
    );
  }

  if (status.state === 'backoff') {
    const wait = Math.max(0, Math.round(status.nextAttemptAt - now));
    return (
      <div style={row}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <StatusBadge status={status} />
          <span style={helpText}>
            Next attempt in {wait}s · last error: {status.lastError}
          </span>
        </div>
      </div>
    );
  }

  if (status.state === 'fatal') {
    return (
      <div style={row}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '80%' }}>
          <StatusBadge status={status} />
          <span style={{ ...helpText, color: 'var(--accent-danger)' }}>{status.message}</span>
        </div>
        <button onClick={onTryAgain} style={ghostBtn}>
          <RefreshCw size={13} style={{ marginRight: 4 }} />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div style={row}>
      <StatusBadge status={status} />
    </div>
  );
}

function TokenBlock({
  status,
  onPaste,
  onClear,
}: {
  status: TunnelStatus | null;
  onPaste: () => void;
  onClear: () => void;
}) {
  const hasToken = status && status.state !== 'idle';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={helpText}>
        Paste the token issued from your kryton.ai dashboard.
      </p>
      {hasToken ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 12, color: 'var(--fg-2)' }}>token configured</code>
          <button onClick={onPaste} style={primaryBtn}>Replace token</button>
          <button onClick={onClear} style={dangerBtn}>
            <Trash2 size={13} style={{ marginRight: 4 }} />
            Clear token
          </button>
        </div>
      ) : (
        <div>
          <button onClick={onPaste} style={primaryBtn}>Paste token</button>
        </div>
      )}
    </div>
  );
}

function StatsBlock({
  stats,
  window,
  onWindowChange,
}: {
  stats: TunnelStats | null;
  window: '24h' | '7d' | '30d';
  onWindowChange: (w: '24h' | '7d' | '30d') => void;
}) {
  const pill: (active: boolean) => CSSProperties = (active) => ({
    padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--fg-3)',
    fontSize: 13, fontWeight: 500, border: '1px solid transparent',
  });

  const maxDaily = stats ? Math.max(1, ...stats.daily.map((d) => d.bytes_in + d.bytes_out)) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['24h', '7d', '30d'] as const).map((w) => (
          <button key={w} onClick={() => onWindowChange(w)} style={pill(window === w)}>
            {w}
          </button>
        ))}
      </div>

      {stats ? (
        <>
          <div style={{ display: 'flex', gap: 16, fontSize: 14, color: 'var(--fg)' }}>
            <span>{stats.requests.toLocaleString()} requests</span>
            <span>↓ {formatBytes(stats.bytes_in)}</span>
            <span>↑ {formatBytes(stats.bytes_out)}</span>
          </div>
          <div
            style={{
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start',
              gap: 2, height: 60,
              padding: 6, borderRadius: 6, background: 'var(--bg-1)', border: '1px solid var(--line)',
            }}
          >
            {stats.daily.length === 0 ? (
              <span style={helpText}>No traffic recorded in this window yet.</span>
            ) : (
              (() => {
                // Pad to the expected bucket count so a 24h window with only
                // one day's data doesn't stretch a single bar across the
                // whole chart. Empty buckets render as a hairline baseline.
                const expected = window === '24h' ? 2 : window === '7d' ? 7 : 30;
                const padded =
                  stats.daily.length >= expected
                    ? stats.daily
                    : [
                        ...Array.from({ length: expected - stats.daily.length }, (_, i) => ({
                          date: `pad-${i}`,
                          requests: 0,
                          bytes_in: 0,
                          bytes_out: 0,
                        })),
                        ...stats.daily,
                      ];
                return padded.map((d) => {
                  const total = d.bytes_in + d.bytes_out;
                  const height = total === 0 ? 2 : Math.max(2, (total / maxDaily) * 48);
                  const isPad = d.date.startsWith('pad-');
                  return (
                    <div
                      key={d.date}
                      title={isPad ? 'no data' : `${d.date}: ${d.requests} req, ${formatBytes(total)}`}
                      style={{
                        flex: 1, height,
                        background: isPad ? 'var(--line)' : 'var(--accent)',
                        opacity: isPad ? 1 : 0.7,
                        borderRadius: 2,
                      }}
                    />
                  );
                });
              })()
            )}
          </div>
        </>
      ) : (
        <span style={helpText}>Loading…</span>
      )}
    </div>
  );
}

function PasteTokenDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await request<TunnelStatus>('/admin/tunnel/token', {
        method: 'POST',
        body: JSON.stringify({ token: token.trim() }),
      });
      setSubmitting(false);
      await onSaved();
    } catch (e: unknown) {
      setSubmitting(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [token, onSaved]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'oklch(0 0 0 / 0.6)',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-1)', borderRadius: 10, padding: 18, width: '92vw', maxWidth: 520,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <h3 style={{ margin: 0, color: 'var(--fg)', fontSize: 16 }}>Paste tunnel token</h3>
        <Field label="Token from kryton.ai dashboard">
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={4}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{
              ...kitInputStyle, fontFamily: 'var(--font-mono)', fontSize: 12,
              minHeight: 80, resize: 'vertical',
            }}
            placeholder="eyJhbGciOiJFZERTQSI..."
          />
        </Field>
        {err && (
          <div style={{ color: 'var(--accent-danger)', fontSize: 13 }}>
            <AlertTriangle size={13} style={{ display: 'inline', marginRight: 4 }} />
            {err}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || token.trim().length === 0} style={primaryBtn}>
            {submitting ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Reference to silence unused-import linter when Copy isn't yet wired up.
void Copy;
