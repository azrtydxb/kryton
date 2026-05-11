import { useState, useEffect, useCallback, CSSProperties, FormEvent } from 'react';
import {
  X, Users, Ticket, Settings, Trash2, ShieldCheck, ShieldOff,
  UserX, UserCheck, Plus, Copy, Check, Key, Package,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { request } from '../lib/api';
import { PluginsTab } from './PluginsTab';
import { Section, Field, Toolbar } from '../components/Settings/settings-kit';
import {
  helpText,
  inputStyle as kitInputStyle,
  primaryBtn,
  ghostBtn,
  dangerBtn,
} from '../components/Settings/settings-kit-styles';

const dialogStyle: CSSProperties = { background: 'var(--bg-1)' };
const borderLine: CSSProperties = { borderColor: 'var(--line)' };
const mutedStyle: CSSProperties = { color: 'var(--fg-3)' };

const errorBoxStyle: CSSProperties = {
  ...helpText,
  marginBottom: 12,
  padding: '8px 10px',
  borderRadius: 5,
  background: 'color-mix(in oklch, var(--accent-danger) 10%, transparent)',
  border: '1px solid color-mix(in oklch, var(--accent-danger) 30%, transparent)',
  color: 'var(--accent-danger)',
  fontFamily: 'var(--font-mono)',
};

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

type Tab = 'users' | 'invites' | 'settings' | 'plugins';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'invites', label: 'Invite Codes', icon: Ticket },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'plugins', label: 'Plugins', icon: Package },
];

export default function AdminPage({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0 0 0 / 0.6)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-panel-title"
        className="rounded-xl shadow-2xl w-[90vw] max-w-2xl overflow-hidden flex flex-col"
        style={{ ...dialogStyle, height: 'min(640px, 85vh)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={borderLine}>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} style={{ color: 'var(--accent)' }} />
            <h2 id="admin-panel-title" className="text-lg font-semibold" style={{ color: 'var(--fg)' }}>
              Admin Panel
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--fg-3)' }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--fg)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--fg-3)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs — mode-pill pattern (matches AccountSettingsPage) */}
        <div className="flex items-center px-4 py-2 border-b" style={{ ...borderLine, gap: 2 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors"
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: tab === t.key ? 'var(--accent-soft)' : 'transparent',
                color: tab === t.key ? 'var(--accent)' : 'var(--fg-3)',
              }}
              onMouseEnter={(e) => {
                if (tab !== t.key) {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--fg)';
                }
              }}
              onMouseLeave={(e) => {
                if (tab !== t.key) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--fg-3)';
                }
              }}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'users' && <UsersSection currentUserId={user?.id ?? ''} />}
          {tab === 'invites' && <InvitesSection />}
          {tab === 'settings' && <SettingsSection />}
          {tab === 'plugins' && <PluginsTab />}
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

  useEffect(() => {
    void (async () => {
      await fetchUsers();
    })();
  }, [fetchUsers]);

  const toggleDisabled = useCallback(async (u: AdminUser) => {
    try {
      const updated = await request<AdminUser>(`/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ disabled: !u.disabled }),
      });
      setUsers(prev => prev.map(x => x.id === updated.id ? updated : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  }, []);

  const toggleRole = useCallback(async (u: AdminUser) => {
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
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    try {
      await request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE' });
      setUsers(prev => prev.filter(x => x.id !== id));
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }, []);

  const submitResetPw = useCallback(async (id: string, e: FormEvent) => {
    e.preventDefault();
    try {
      await request('/admin/users/' + id + '/reset-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPwValue }),
      });
      setResetPwUser(null);
      setResetPwValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  }, [resetPwValue]);

  return (
    <div style={{ color: 'var(--fg-1)' }}>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <Section title="users">
        <div style={helpText}>Manage application users — toggle roles, disable accounts, or reset passwords.</div>
        {loading ? (
          <div style={helpText}>Loading users...</div>
        ) : users.length === 0 ? (
          <div style={helpText}>No users found.</div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            {users.map(u => {
              const isSelf = u.id === currentUserId;
              return (
                <div key={u.id} style={rowStyle}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {u.name || u.email}
                      <span style={{ marginLeft: 8, color: 'var(--fg-3)', fontSize: 11 }}>
                        {u.name ? u.email : ''}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)',
                      marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    }}>
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={u.role === 'admin'
                          ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                          : { background: 'var(--bg-2)', color: 'var(--fg)' }}
                      >
                        {u.role === 'admin' ? <ShieldCheck size={10} /> : null}
                        {u.role}
                      </span>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={u.disabled
                          ? { background: 'color-mix(in oklch, var(--accent-danger) 20%, transparent)', color: 'var(--accent-danger)' }
                          : { background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' }}
                      >
                        {u.disabled ? 'Disabled' : 'Active'}
                      </span>
                      <span>Joined {new Date(u.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, marginLeft: 8, alignItems: 'center' }}>
                    {isSelf ? (
                      <span style={{ ...mutedStyle, fontSize: 11, fontFamily: 'var(--font-mono)' }}>(you)</span>
                    ) : confirmDelete === u.id ? (
                      <>
                        <button onClick={() => deleteUser(u.id)} style={dangerBtn}>Confirm</button>
                        <button onClick={() => setConfirmDelete(null)} style={ghostBtn}>Cancel</button>
                      </>
                    ) : resetPwUser === u.id ? (
                      <form onSubmit={e => submitResetPw(u.id, e)} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="password"
                          value={resetPwValue}
                          onChange={e => setResetPwValue(e.target.value)}
                          placeholder="New password"
                          minLength={8}
                          required
                          style={{ ...kitInputStyle, width: 140, padding: '4px 8px', fontSize: 11 }}
                          autoFocus
                        />
                        <button type="submit" style={primaryBtn}>Set</button>
                        <button type="button" onClick={() => setResetPwUser(null)} style={ghostBtn}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <IconBtn
                          onClick={() => toggleDisabled(u)}
                          title={u.disabled ? 'Enable user' : 'Disable user'}
                          color={u.disabled ? 'var(--accent-good)' : 'var(--accent-warn)'}
                          icon={u.disabled ? <UserCheck size={14} /> : <UserX size={14} />}
                        />
                        <IconBtn
                          onClick={() => toggleRole(u)}
                          title={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                          color="var(--accent)"
                          icon={u.role === 'admin' ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
                        />
                        <IconBtn
                          onClick={() => { setResetPwUser(u.id); setResetPwValue(''); }}
                          title="Reset password"
                          color="var(--accent-warn)"
                          icon={<Key size={14} />}
                        />
                        <IconBtn
                          onClick={() => setConfirmDelete(u.id)}
                          title="Delete user"
                          color="var(--accent-danger)"
                          icon={<Trash2 size={14} />}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function IconBtn({
  onClick, title, color, icon,
}: {
  onClick: () => void;
  title: string;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-lg transition-colors"
      style={{ color, background: 'transparent', border: 'none', cursor: 'pointer' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
    </button>
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

  useEffect(() => {
    void (async () => {
      await fetchInvites();
    })();
  }, [fetchInvites]);

  const createInvite = useCallback(async () => {
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
  }, []);

  const deleteInvite = useCallback(async (id: string) => {
    try {
      await request<{ ok: boolean }>(`/admin/invites/${id}`, { method: 'DELETE' });
      setInvites(prev => prev.filter(x => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete invite');
    }
  }, []);

  const copyCode = useCallback((invite: InviteCode) => {
    navigator.clipboard.writeText(invite.code).then(() => {
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const getStatus = (invite: InviteCode): { label: string; style: CSSProperties } => {
    if (invite.usedBy) return { label: 'Used', style: { background: 'var(--bg-2)', color: 'var(--fg-3)' } };
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return { label: 'Expired', style: { background: 'color-mix(in oklch, var(--accent-danger) 20%, transparent)', color: 'var(--accent-danger)' } };
    }
    return { label: 'Unused', style: { background: 'color-mix(in oklch, var(--accent-good) 20%, transparent)', color: 'var(--accent-good)' } };
  };

  return (
    <div style={{ color: 'var(--fg-1)' }}>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <Section title="invite codes">
        <div style={helpText}>Generate invite codes that allow new users to register when sign-up is restricted.</div>

        <Toolbar>
          <button
            onClick={createInvite}
            disabled={creating}
            style={{ ...primaryBtn, opacity: creating ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={13} />
            {creating ? 'Creating…' : 'Create Invite'}
          </button>
        </Toolbar>

        <div style={{ marginTop: 14 }}>
          {loading ? (
            <div style={helpText}>Loading invite codes...</div>
          ) : invites.length === 0 ? (
            <div style={helpText}>No invite codes yet.</div>
          ) : (
            invites.map(invite => {
              const status = getStatus(invite);
              return (
                <div key={invite.id} style={rowStyle}>
                  <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <code style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg)',
                      background: 'var(--bg-2)', padding: '3px 8px', borderRadius: 4,
                    }}>
                      {invite.code}
                    </code>
                    <IconBtn
                      onClick={() => copyCode(invite)}
                      title="Copy code"
                      color={copiedId === invite.id ? 'var(--accent-good)' : 'var(--fg-3)'}
                      icon={copiedId === invite.id ? <Check size={13} /> : <Copy size={13} />}
                    />
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={status.style}
                    >
                      {status.label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                      Created {new Date(invite.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <IconBtn
                    onClick={() => deleteInvite(invite.id)}
                    title="Delete invite"
                    color="var(--accent-danger)"
                    icon={<Trash2 size={14} />}
                  />
                </div>
              );
            })
          )}
        </div>
      </Section>
    </div>
  );
}

/* ────────────────────────── Settings Section ────────────────────────── */

function SettingsSection() {
  const [mode, setMode] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const data = await request<{ mode: string }>('/admin/settings/registration');
      setMode(data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadSettings();
    })();
  }, [loadSettings]);

  const updateMode = useCallback(async (newMode: string) => {
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
  }, []);

  const modeBtnStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '12px 16px',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--fg-3)',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    transition: 'background 120ms, color 120ms, border-color 120ms',
  });

  return (
    <div style={{ color: 'var(--fg-1)' }}>
      {error && <div style={errorBoxStyle}>{error}</div>}

      <Section title="registration mode">
        <div style={helpText}>Control how new users can sign up for the application.</div>

        {loading ? (
          <div style={helpText}>Loading settings...</div>
        ) : (
          <Field label="signup policy">
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => updateMode('open')}
                disabled={saving}
                style={{ ...modeBtnStyle(mode === 'open'), opacity: saving ? 0.5 : 1 }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Open Registration</div>
                <div style={{ fontSize: 11, opacity: 0.75, textTransform: 'none' }}>Anyone can create an account</div>
              </button>
              <button
                onClick={() => updateMode('invite-only')}
                disabled={saving}
                style={{ ...modeBtnStyle(mode === 'invite-only'), opacity: saving ? 0.5 : 1 }}
              >
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Invite Only</div>
                <div style={{ fontSize: 11, opacity: 0.75, textTransform: 'none' }}>Requires a valid invite code</div>
              </button>
            </div>
            {saving && <div style={{ ...helpText, marginTop: 8 }}>Saving…</div>}
          </Field>
        )}
      </Section>
    </div>
  );
}
