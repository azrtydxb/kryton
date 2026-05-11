import { useState, useCallback, FormEvent, CSSProperties } from 'react';
import { Settings, User, Fingerprint, Key, Shield, X, Palette } from 'lucide-react';

const inputStyle: CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
  color: 'var(--fg)',
};
const dialogStyle: CSSProperties = { background: 'var(--bg-1)' };
const borderLine: CSSProperties = { borderColor: 'var(--line)' };
const labelStyle: CSSProperties = { color: 'var(--fg-3)' };
const headingStyle: CSSProperties = { color: 'var(--fg)' };
const mutedStyle: CSSProperties = { color: 'var(--fg-3)' };
const submitStyle: CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
};
const ghostHoverBase: CSSProperties = { color: 'var(--fg-3)' };
import { authApi } from '../lib/api';
import { PasskeyManagerContent } from '../components/Security/PasskeyManager';
import { ApiKeyManager } from '../components/ApiKeys/ApiKeyManager';
import { TwoFactorManager } from '../components/Security/TwoFactorManager';
import { AppearanceSection } from '../components/Settings/AppearanceSection';

type Tab = 'profile' | 'appearance' | 'passkeys' | 'api-keys' | '2fa';

const TABS: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'passkeys', label: 'Passkeys', icon: Fingerprint },
  { key: 'api-keys', label: 'API Keys', icon: Key },
  { key: '2fa', label: '2FA', icon: Shield },
];

function ProfileSection() {
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handlePasswordChange = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return; }
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      await authApi.changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  }, [currentPw, newPw, confirmPw]);

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1" style={headingStyle}>Change Password</h3>
        <p className="text-xs" style={mutedStyle}>Update your account password.</p>
      </div>
      <form onSubmit={handlePasswordChange} className="space-y-3">
        <div>
          <label htmlFor="current-password" className="block text-xs mb-1" style={labelStyle}>Current Password</label>
          <input
            id="current-password"
            type="password"
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            required
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-soft)'; }}
            onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-xs mb-1" style={labelStyle}>New Password</label>
          <input
            id="new-password"
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            required
            minLength={8}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-soft)'; }}
            onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-xs mb-1" style={labelStyle}>Confirm New Password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            required
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
            onFocus={e => { e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-soft)'; }}
            onBlur={e => { e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
        {pwError && <div className="text-xs" style={{ color: 'var(--accent-danger)' }}>{pwError}</div>}
        {pwSuccess && <div className="text-xs" style={{ color: 'var(--accent-good)' }}>Password changed successfully!</div>}
        <div className="flex pt-1">
          <button
            type="submit"
            disabled={pwLoading}
            className="rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            style={{ ...submitStyle, padding: '8px 16px' }}
          >
            {pwLoading ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AccountSettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0 0 0 / 0.6)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        className="rounded-xl shadow-2xl w-[90vw] max-w-2xl overflow-hidden flex flex-col"
        // Fixed height (not max-height) so the header + tab strip stay
        // anchored as the user switches between sections. The content
        // panel scrolls within its own pane.
        style={{ ...dialogStyle, height: 'min(640px, 85vh)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={borderLine}>
          <div className="flex items-center gap-2">
            <Settings size={18} style={{ color: 'var(--accent)' }} />
            <h2 id="account-settings-title" className="text-lg font-semibold" style={{ color: 'var(--fg)' }}>Account Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={ghostHoverBase}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--fg)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--fg-3)'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs — mode-pill pattern from prototype/app/graph.jsx: active tab
            sits in an accent-soft tinted pill (no underline). Inactive tabs
            are fg-3 with transparent bg. Container has its own subtle gap
            and a single border-b for visual separation. */}
        <div
          className="flex items-center px-4 py-2 border-b"
          style={{ ...borderLine, gap: 2 }}
        >
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
          {tab === 'profile' && <ProfileSection />}
          {tab === 'appearance' && <AppearanceSection />}
          {tab === 'passkeys' && <PasskeyManagerContent />}
          {tab === 'api-keys' && <ApiKeyManager />}
          {tab === '2fa' && <TwoFactorManager />}
        </div>
      </div>
    </div>
  );
}
