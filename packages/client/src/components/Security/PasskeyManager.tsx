import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Fingerprint, Trash2, X } from 'lucide-react';
import { authClient } from '../../lib/auth-client';
import { Section, Field, Toolbar } from '../Settings/settings-kit';
import {
  helpText,
  inputStyle,
  primaryBtn,
  ghostBtn,
  dangerBtn,
} from '../Settings/settings-kit-styles';

interface PasskeyData {
  id: string;
  name?: string;
  createdAt: Date;
  credentialID: string;
}

interface PasskeyManagerProps {
  open: boolean;
  onClose: () => void;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: 'var(--bg-1)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 8,
};

const errorStyle: CSSProperties = {
  ...helpText,
  marginBottom: 12,
  padding: '8px 10px',
  borderRadius: 5,
  background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)',
  border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
  color: 'var(--accent-danger)',
  fontFamily: 'var(--font-mono)',
};

export function PasskeyManagerContent() {
  const [passkeys, setPasskeys] = useState<PasskeyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchPasskeys = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.data) {
        setPasskeys(result.data as PasskeyData[]);
      } else if (result.error) {
        setError(result.error.message || 'Failed to load passkeys');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load passkeys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  const handleAddPasskey = async () => {
    setAdding(true);
    setError('');
    try {
      const result = await authClient.passkey.addPasskey({
        name: newPasskeyName.trim() || undefined,
      });
      if (result.error) {
        setError(String(result.error.message) || 'Failed to register passkey');
      } else {
        setShowNamePrompt(false);
        setNewPasskeyName('');
        await fetchPasskeys();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register passkey');
    } finally {
      setAdding(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    setDeletingId(id);
    setError('');
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) {
        setError(result.error.message || 'Failed to delete passkey');
      } else {
        setConfirmDeleteId(null);
        await fetchPasskeys();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete passkey');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ color: 'var(--fg-1)' }}>
      <p style={helpText}>
        Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password.
      </p>

      {error && <div style={errorStyle}>{error}</div>}

      <Section title="passkeys">
        {loading ? (
          <div style={helpText}>Loading passkeys...</div>
        ) : passkeys.length === 0 ? (
          <div style={helpText}>No passkeys registered yet.</div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {passkeys.map(pk => (
              <div key={pk.id} style={rowStyle}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pk.name || 'Unnamed passkey'}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--fg-3)',
                      marginTop: 2,
                    }}
                  >
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {confirmDeleteId === pk.id ? (
                  <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                    <button
                      onClick={() => handleDeletePasskey(pk.id)}
                      disabled={deletingId === pk.id}
                      style={{ ...dangerBtn, opacity: deletingId === pk.id ? 0.5 : 1 }}
                    >
                      {deletingId === pk.id ? '...' : 'Confirm'}
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} style={ghostBtn}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(pk.id)}
                    style={{
                      ...ghostBtn,
                      padding: 6,
                      marginLeft: 8,
                      display: 'inline-flex',
                      alignItems: 'center',
                      color: 'var(--fg-3)',
                    }}
                    aria-label="Delete passkey"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showNamePrompt ? (
          <>
            <Field label="name">
              <input
                type="text"
                value={newPasskeyName}
                onChange={e => setNewPasskeyName(e.target.value)}
                placeholder="Passkey name (optional)"
                autoFocus
                style={inputStyle}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddPasskey();
                }}
              />
            </Field>
            <Toolbar>
              <button
                onClick={handleAddPasskey}
                disabled={adding}
                style={{ ...primaryBtn, opacity: adding ? 0.5 : 1 }}
              >
                {adding ? 'Registering...' : 'Register'}
              </button>
              <button
                onClick={() => {
                  setShowNamePrompt(false);
                  setNewPasskeyName('');
                }}
                style={ghostBtn}
              >
                Cancel
              </button>
            </Toolbar>
          </>
        ) : (
          <Toolbar>
            <button onClick={() => setShowNamePrompt(true)} style={primaryBtn}>
              Add Passkey
            </button>
          </Toolbar>
        )}
      </Section>
    </div>
  );
}

export function PasskeyManager({ open, onClose }: PasskeyManagerProps) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0 0 0 / 0.6)' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-1)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 20,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 20px 40px oklch(0 0 0 / 0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Fingerprint size={18} style={{ color: 'var(--accent)' }} />
            <h3
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--fg)',
                margin: 0,
              }}
            >
              Passkeys
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ ...ghostBtn, padding: 6, display: 'inline-flex', alignItems: 'center' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <PasskeyManagerContent />
      </div>
    </div>,
    document.body
  );
}
