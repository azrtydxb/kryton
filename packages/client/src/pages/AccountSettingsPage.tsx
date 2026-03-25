import { useState, useCallback, FormEvent } from 'react';
import { Settings, User, Fingerprint, Key, X } from 'lucide-react';
import { authApi } from '../lib/api';
import { PasskeyManagerContent } from '../components/Security/PasskeyManager';
import { ApiKeyManager } from '../components/ApiKeys/ApiKeyManager';

type Tab = 'profile' | 'passkeys' | 'api-keys';

const TABS: { key: Tab; label: string; icon: typeof User }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'passkeys', label: 'Passkeys', icon: Fingerprint },
  { key: 'api-keys', label: 'API Keys', icon: Key },
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
        <h3 className="text-sm font-medium text-gray-200 mb-1">Change Password</h3>
        <p className="text-xs text-gray-500">Update your account password.</p>
      </div>
      <form onSubmit={handlePasswordChange} className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Current Password</label>
          <input
            type="password"
            value={currentPw}
            onChange={e => setCurrentPw(e.target.value)}
            required
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">New Password</label>
          <input
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            required
            minLength={8}
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Confirm New Password</label>
          <input
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            required
            className="w-full bg-surface-800 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />
        </div>
        {pwError && <div className="text-red-400 text-xs">{pwError}</div>}
        {pwSuccess && <div className="text-green-400 text-xs">Password changed successfully!</div>}
        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={pwLoading}
            className="flex-1 bg-violet-500 text-white rounded-lg py-2 text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50"
          >
            {pwLoading ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AccountSettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('api-keys');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 rounded-xl shadow-2xl w-[90vw] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-white">Account Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700/50 px-6">
          {TABS.map(t => (
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
          {tab === 'profile' && <ProfileSection />}
          {tab === 'passkeys' && <PasskeyManagerContent />}
          {tab === 'api-keys' && <ApiKeyManager />}
        </div>
      </div>
    </div>
  );
}
