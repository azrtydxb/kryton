import { useState, useEffect, useCallback } from 'react';
import type { ApiKeyInfo as UiApiKeyInfo, ApiKeyScope, ApiKeyExpiry, NewApiKeyResult } from '@azrtydxb/ui';
import { apiKeyApi } from '../../lib/api';
import { Section, Field, Toolbar } from '../Settings/settings-kit';
import {
  helpText,
  inputStyle,
  primaryBtn,
  ghostBtn,
  dangerBtn,
} from '../Settings/settings-kit-styles';

/**
 * Renders the API-keys management surface inline, matching the visual
 * language of AppearanceSection (the Settings dialog gold standard).
 * Data is fetched via apiKeyApi; rendering uses the shared settings-kit.
 */
export function ApiKeyManager() {
  const [keys, setKeys] = useState<UiApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKeyResult, setNewKeyResult] = useState<NewApiKeyResult | null>(null);

  // Create-form state.
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formScope, setFormScope] = useState<ApiKeyScope>('read-only');
  const [formExpiry, setFormExpiry] = useState<ApiKeyExpiry>('90d');
  const [submitting, setSubmitting] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiKeyApi.list();
      setKeys(
        result.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scope: k.scope as ApiKeyScope,
          lastUsedAt: k.lastUsedAt,
          expiresAt: k.expiresAt,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchKeys();
    })();
  }, [fetchKeys]);

  const handleMint = useCallback(async () => {
    if (!formName.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let expiresAt: string | undefined;
      if (formExpiry !== 'never') {
        const d = new Date();
        if (formExpiry === '30d') d.setDate(d.getDate() + 30);
        else if (formExpiry === '90d') d.setDate(d.getDate() + 90);
        else if (formExpiry === '1y') d.setFullYear(d.getFullYear() + 1);
        expiresAt = d.toISOString();
      }
      const result = await apiKeyApi.create({ name: formName.trim(), scope: formScope, expiresAt });
      setNewKeyResult({ id: result.id, key: result.key });
      setFormName('');
      setFormScope('read-only');
      setFormExpiry('90d');
      setShowForm(false);
      await fetchKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setSubmitting(false);
    }
  }, [fetchKeys, formName, formScope, formExpiry]);

  const handleRevoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await apiKeyApi.revoke(id);
        if (newKeyResult?.id === id) setNewKeyResult(null);
        await fetchKeys();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to revoke API key');
      }
    },
    [fetchKeys, newKeyResult],
  );

  const errorText: React.CSSProperties = { ...helpText, color: 'var(--accent-danger)', marginBottom: 12 };

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-1)',
    border: '1px solid var(--line)',
    borderRadius: 6,
    padding: '10px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  };

  const badgeStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 10.5,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--fg-3)',
    border: '1px solid var(--line)',
    borderRadius: 4,
    padding: '2px 6px',
    background: 'var(--bg-2)',
  };

  const monoName: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--fg)',
  };

  const formatLastUsed = (iso?: string | null) => {
    if (!iso) return 'never used';
    const d = new Date(iso);
    return `used ${d.toLocaleDateString()}`;
  };

  return (
    <Section title="api keys">
      <div style={helpText}>
        Personal access tokens for programmatic access. Treat them like passwords.
      </div>

      {error && <div style={errorText}>{error}</div>}

      {newKeyResult && (
        <div
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 12,
          }}
        >
          <div style={{ ...helpText, marginBottom: 6 }}>
            Copy this key now — it will not be shown again.
          </div>
          <div style={{ ...monoName, wordBreak: 'break-all', marginBottom: 8 }}>
            {newKeyResult.key}
          </div>
          <Toolbar>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => {
                void navigator.clipboard?.writeText(newKeyResult.key);
              }}
            >
              copy
            </button>
            <button type="button" style={ghostBtn} onClick={() => setNewKeyResult(null)}>
              dismiss
            </button>
          </Toolbar>
        </div>
      )}

      {loading ? (
        <div style={helpText}>Loading keys...</div>
      ) : keys.length === 0 ? (
        <div style={helpText}>No API keys yet.</div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          {keys.map((k) => (
            <div key={k.id} style={cardStyle}>
              <div style={{ ...monoName, minWidth: 0 }}>
                {k.name}
                <span style={{ color: 'var(--fg-3)', marginLeft: 8 }}>{k.keyPrefix}…</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                <span style={badgeStyle}>{k.scope}</span>
                <span style={badgeStyle}>{formatLastUsed(k.lastUsedAt)}</span>
                <button type="button" style={dangerBtn} onClick={() => handleRevoke(k.id)}>
                  revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <Toolbar>
          <button type="button" style={primaryBtn} onClick={() => setShowForm(true)}>
            create key
          </button>
        </Toolbar>
      ) : (
        <div style={{ marginTop: 6 }}>
          <Field label="name">
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. ci-pipeline"
              style={inputStyle}
              autoFocus
            />
          </Field>
          <Field label="scope">
            <select
              value={formScope}
              onChange={(e) => setFormScope(e.target.value as ApiKeyScope)}
              style={inputStyle}
            >
              <option value="read-only">read-only</option>
              <option value="read-write">read-write</option>
            </select>
          </Field>
          <Field label="expires in">
            <select
              value={formExpiry}
              onChange={(e) => setFormExpiry(e.target.value as ApiKeyExpiry)}
              style={inputStyle}
            >
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="1y">1 year</option>
              <option value="never">never</option>
            </select>
          </Field>
          <Toolbar>
            <button
              type="button"
              style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}
              onClick={handleMint}
              disabled={submitting}
            >
              {submitting ? 'creating…' : 'generate'}
            </button>
            <button
              type="button"
              style={ghostBtn}
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              disabled={submitting}
            >
              cancel
            </button>
          </Toolbar>
        </div>
      )}
    </Section>
  );
}
