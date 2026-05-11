import { useState, useEffect, useCallback, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Fingerprint, Plus, Trash2, X } from 'lucide-react';
import { authClient } from '../../lib/auth-client';

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
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
  color: 'var(--fg)',
};

const inputStyle: CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
  color: 'var(--fg)',
};

const primaryBtnStyle: CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
};

const ghostBtnStyle: CSSProperties = {
  color: 'var(--fg-3)',
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
    <>
      <p className="text-xs mb-4" style={{ color: 'var(--fg-3)' }}>
        Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password.
      </p>

      {/* Error */}
      {error && (
        <div
          className="mb-4 rounded-lg border px-3 py-2 text-xs"
          style={{ background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)', borderColor: 'color-mix(in oklch, var(--accent-danger) 30%, transparent)', color: 'var(--accent-danger)' }}
        >
          {error}
        </div>
      )}

      {/* Passkey list */}
      <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
        {loading ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--fg-3)' }}>Loading passkeys...</div>
        ) : passkeys.length === 0 ? (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--fg-3)' }}>No passkeys registered yet.</div>
        ) : (
          passkeys.map(pk => (
            <div
              key={pk.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
              style={rowStyle}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" style={{ color: 'var(--fg)' }}>
                  {pk.name || 'Unnamed passkey'}
                </div>
                <div className="text-xs" style={{ color: 'var(--fg-3)' }}>
                  Added {new Date(pk.createdAt).toLocaleDateString()}
                </div>
              </div>
              {confirmDeleteId === pk.id ? (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId === pk.id}
                    className="text-xs px-2 py-1 rounded disabled:opacity-50"
                    style={{ color: 'var(--accent-danger)', background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)' }}
                  >
                    {deletingId === pk.id ? '...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs px-2 py-1"
                    style={ghostBtnStyle}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(pk.id)}
                  className="ml-2 p-1.5 transition-colors"
                  style={{ color: 'var(--fg-3)' }}
                  aria-label="Delete passkey"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add passkey */}
      {showNamePrompt ? (
        <div className="space-y-2">
          <input
            type="text"
            value={newPasskeyName}
            onChange={e => setNewPasskeyName(e.target.value)}
            placeholder="Passkey name (optional)"
            autoFocus
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') handleAddPasskey(); }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddPasskey}
              disabled={adding}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={primaryBtnStyle}
            >
              {adding ? 'Registering...' : 'Register Passkey'}
            </button>
            <button
              onClick={() => { setShowNamePrompt(false); setNewPasskeyName(''); }}
              className="px-3 py-2 text-sm transition-colors"
              style={ghostBtnStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNamePrompt(true)}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-2.5 text-sm font-medium transition-colors"
          style={{ borderColor: 'var(--line)', color: 'var(--fg)' }}
        >
          <Plus size={16} />
          Add Passkey
        </button>
      )}
    </>
  );
}

export function PasskeyManager({ open, onClose }: PasskeyManagerProps) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'oklch(0 0 0 / 0.6)' }} onClick={onClose}>
      <div
        className="rounded-xl shadow-2xl w-full max-w-md p-6 border"
        style={{ background: 'var(--bg-1)', borderColor: 'var(--line)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Fingerprint size={20} style={{ color: 'var(--accent)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--fg)' }}>Passkeys</h3>
          </div>
          <button onClick={onClose} className="p-1 transition-colors" style={ghostBtnStyle} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <PasskeyManagerContent />
      </div>
    </div>,
    document.body
  );
}
