import { useState, useEffect, useCallback } from 'react';
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
      <p className="text-xs text-gray-400 mb-4">
        Passkeys let you sign in with your fingerprint, face, or device PIN instead of a password.
      </p>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Passkey list */}
      <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
        {loading ? (
          <div className="text-center py-6 text-gray-500 text-sm">Loading passkeys...</div>
        ) : passkeys.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">No passkeys registered yet.</div>
        ) : (
          passkeys.map(pk => (
            <div
              key={pk.id}
              className="flex items-center justify-between rounded-lg bg-surface-800 border border-gray-700/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-200 truncate">
                  {pk.name || 'Unnamed passkey'}
                </div>
                <div className="text-xs text-gray-500">
                  Added {new Date(pk.createdAt).toLocaleDateString()}
                </div>
              </div>
              {confirmDeleteId === pk.id ? (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId === pk.id}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 disabled:opacity-50"
                  >
                    {deletingId === pk.id ? '...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(pk.id)}
                  className="ml-2 p-1.5 text-gray-500 hover:text-red-400 transition-colors"
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
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            onKeyDown={e => { if (e.key === 'Enter') handleAddPasskey(); }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddPasskey}
              disabled={adding}
              className="flex-1 bg-violet-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
            >
              {adding ? 'Registering...' : 'Register Passkey'}
            </button>
            <button
              onClick={() => { setShowNamePrompt(false); setNewPasskeyName(''); }}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNamePrompt(true)}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-300 hover:border-violet-500 hover:text-violet-400 transition-colors"
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
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-surface-900 rounded-xl shadow-2xl w-full max-w-md p-6 border border-gray-700/50"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Fingerprint size={20} className="text-violet-400" />
            <h3 className="text-lg font-semibold text-gray-100">Passkeys</h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <PasskeyManagerContent />
      </div>
    </div>,
    document.body
  );
}
