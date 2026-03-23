import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { request } from '../lib/api';
import { X, Users, Ticket, Settings, Trash2, ShieldCheck, ShieldOff, UserX, UserCheck, Plus, Copy, Check, Key } from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  createdAt: string;
}

interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  usedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

type Tab = 'users' | 'invites' | 'settings';

export default function AdminPage({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Admin Panel</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700/50 px-6">
          {([
            { key: 'users' as Tab, label: 'Users', icon: Users },
            { key: 'invites' as Tab, label: 'Invite Codes', icon: Ticket },
            { key: 'settings' as Tab, label: 'Settings', icon: Settings },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'users' && <UsersSection currentUserId={user?.id ?? ''} />}
          {tab === 'invites' && <InvitesSection />}
          {tab === 'settings' && <SettingsSection />}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────── Users Section ────────────────────────── */

function UsersSection({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [resetPwUser, setResetPwUser] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await request<AdminUser[]>('/admin/users');
      setUsers(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleDisabled = async (u: AdminUser) => {
    try {
      const updated = await request<AdminUser>(`/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ disabled: !u.disabled }),
      });
      setUsers(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const toggleRole = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    try {
      const updated = await request<AdminUser>(`/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      setUsers(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  };

  const deleteUser = async (id: string) => {
    try {
      await request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE' });
      setUsers(prev => prev.filter(x => x.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading users...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-700/50">
              <th className="pb-3 font-medium">Name</th>
              <th className="pb-3 font-medium">Email</th>
              <th className="pb-3 font-medium">Role</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Joined</th>
              <th className="pb-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-b border-gray-700/30">
                  <td className="py-3 text-white">{u.name || '-'}</td>
                  <td className="py-3 text-gray-300">{u.email}</td>
                  <td className="py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === 'admin'
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-gray-700/50 text-gray-300'
                    }`}>
                      {u.role === 'admin' ? <ShieldCheck size={12} /> : null}
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.disabled
                        ? 'bg-red-500/20 text-red-300'
                        : 'bg-green-500/20 text-green-300'
                    }`}>
                      {u.disabled ? 'Disabled' : 'Active'}
                    </span>
                  </td>
                  <td className="py-3 text-gray-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    {isSelf ? (
                      <span className="text-xs text-gray-500">(you)</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => toggleDisabled(u)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            u.disabled
                              ? 'text-green-400 hover:bg-green-500/10'
                              : 'text-yellow-400 hover:bg-yellow-500/10'
                          }`}
                          title={u.disabled ? 'Enable user' : 'Disable user'}
                        >
                          {u.disabled ? <UserCheck size={15} /> : <UserX size={15} />}
                        </button>
                        <button
                          onClick={() => toggleRole(u)}
                          className="p-1.5 rounded-lg text-violet-400 hover:bg-violet-500/10 transition-colors"
                          title={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                        >
                          {u.role === 'admin' ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                        </button>
                        {confirmDelete === u.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteUser(u.id)}
                              className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {resetPwUser === u.id ? (
                              <form onSubmit={async (e) => {
                                e.preventDefault();
                                try {
                                  await request('/admin/users/' + u.id + '/reset-password', { method: 'POST', body: JSON.stringify({ newPassword: resetPwValue }) });
                                  setResetPwUser(null); setResetPwValue('');
                                } catch (err) { setError(err instanceof Error ? err.message : 'Reset failed'); }
                              }} className="flex items-center gap-1">
                                <input type="password" value={resetPwValue} onChange={e => setResetPwValue(e.target.value)}
                                  placeholder="New password" minLength={8} required
                                  className="w-24 bg-surface-800 border border-gray-700/50 rounded px-1.5 py-0.5 text-xs text-gray-100" />
                                <button type="submit" className="text-xs text-green-400 hover:text-green-300">Set</button>
                                <button type="button" onClick={() => setResetPwUser(null)} className="text-xs text-gray-400">✕</button>
                              </form>
                            ) : (
                              <button
                                onClick={() => { setResetPwUser(u.id); setResetPwValue(''); }}
                                className="p-1.5 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                                title="Reset password"
                              >
                                <Key size={15} />
                              </button>
                            )}
                            <button
                              onClick={() => setConfirmDelete(u.id)}
                              className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete user"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {users.length === 0 && !loading && (
        <div className="text-center text-gray-500 py-8 text-sm">No users found.</div>
      )}
    </div>
  );
}

/* ────────────────────────── Invites Section ────────────────────────── */

function InvitesSection() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await request<InviteCode[]>('/admin/invites');
      setInvites(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const createInvite = async () => {
    try {
      setCreating(true);
      const invite = await request<InviteCode>('/admin/invites', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setInvites(prev => [invite, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const deleteInvite = async (id: string) => {
    try {
      await request<{ ok: boolean }>(`/admin/invites/${id}`, { method: 'DELETE' });
      setInvites(prev => prev.filter(x => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete invite');
    }
  };

  const copyCode = (invite: InviteCode) => {
    navigator.clipboard.writeText(invite.code).then(() => {
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const getStatus = (invite: InviteCode): { label: string; className: string } => {
    if (invite.usedBy) return { label: 'Used', className: 'bg-gray-700/50 text-gray-400' };
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return { label: 'Expired', className: 'bg-red-500/20 text-red-300' };
    }
    return { label: 'Unused', className: 'bg-green-500/20 text-green-300' };
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading invite codes...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      <div className="mb-4">
        <button
          onClick={createInvite}
          disabled={creating}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-50 transition-colors"
        >
          <Plus size={16} />
          {creating ? 'Creating...' : 'Create Invite'}
        </button>
      </div>
      <div className="space-y-2">
        {invites.map(invite => {
          const status = getStatus(invite);
          return (
            <div
              key={invite.id}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-800 border border-gray-700/30"
            >
              <div className="flex items-center gap-4">
                <code className="text-sm font-mono text-white bg-gray-700/50 px-2.5 py-1 rounded">
                  {invite.code}
                </code>
                <button
                  onClick={() => copyCode(invite)}
                  className="p-1 text-gray-400 hover:text-white transition-colors"
                  title="Copy code"
                >
                  {copiedId === invite.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                  {status.label}
                </span>
                <span className="text-xs text-gray-500">
                  Created {new Date(invite.createdAt).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => deleteInvite(invite.id)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                title="Delete invite"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
      {invites.length === 0 && !loading && (
        <div className="text-center text-gray-500 py-8 text-sm">No invite codes yet.</div>
      )}
    </div>
  );
}

/* ────────────────────────── Settings Section ────────────────────────── */

function SettingsSection() {
  const [mode, setMode] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request<{ mode: string }>('/admin/settings/registration')
      .then(data => {
        setMode(data.mode);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoading(false);
      });
  }, []);

  const updateMode = async (newMode: string) => {
    try {
      setSaving(true);
      const data = await request<{ mode: string }>('/admin/settings/registration', {
        method: 'PUT',
        body: JSON.stringify({ mode: newMode }),
      });
      setMode(data.mode);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading settings...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      <div className="bg-surface-800 rounded-lg border border-gray-700/30 p-6">
        <h3 className="text-white font-medium mb-1">Registration Mode</h3>
        <p className="text-sm text-gray-400 mb-4">
          Control how new users can sign up for the application.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => updateMode('open')}
            disabled={saving}
            className={`flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'open'
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'
            } disabled:opacity-50`}
          >
            <div className="font-medium mb-0.5">Open Registration</div>
            <div className="text-xs opacity-70">Anyone can create an account</div>
          </button>
          <button
            onClick={() => updateMode('invite-only')}
            disabled={saving}
            className={`flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
              mode === 'invite-only'
                ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                : 'border-gray-700/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'
            } disabled:opacity-50`}
          >
            <div className="font-medium mb-0.5">Invite Only</div>
            <div className="text-xs opacity-70">Requires a valid invite code</div>
          </button>
        </div>
        {saving && <p className="text-xs text-gray-500 mt-3">Saving...</p>}
      </div>
    </div>
  );
}
