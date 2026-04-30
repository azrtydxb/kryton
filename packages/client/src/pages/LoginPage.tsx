import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../lib/api';
import { authClient } from '../lib/auth-client';

type Tab = 'signin' | 'register';

export default function LoginPage() {
  const { login, register, loginWithGoogle, loginWithGithub } = useAuth();

  const [tab, setTab] = useState<Tab>('signin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<string>('open');

  // 2FA state — shown after successful password auth when 2FA is required
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);

  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);

  // Sign in fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  useEffect(() => {
    authApi.config().then((cfg: { registrationMode: string; googleEnabled?: boolean; githubEnabled?: boolean; smtpEnabled?: boolean }) => {
      setRegistrationMode(cfg.registrationMode);
      setGoogleEnabled(cfg.googleEnabled ?? false);
      setGithubEnabled(cfg.githubEnabled ?? false);
      setSmtpEnabled(cfg.smtpEnabled ?? false);
    }).catch(() => {});
  }, []);

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.twoFactorRequired) {
        setTwoFactorRequired(true);
        setTotpCode('');
        setUseBackupCode(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let result;
      if (useBackupCode) {
        result = await authClient.twoFactor.verifyBackupCode({ code: totpCode });
      } else {
        result = await authClient.twoFactor.verifyTotp({ code: totpCode });
      }
      if (result.error) {
        setError(result.error.message || 'Invalid code. Please try again.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        setError(String(result.error.message) || 'Passkey authentication failed');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Passkey authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(
        regEmail,
        regPassword,
        regName,
        registrationMode === 'invite-only' ? inviteCode : undefined,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthGoogle = () => {
    loginWithGoogle(registrationMode === 'invite-only' ? inviteCode : undefined);
  };

  const handleOAuthGithub = () => {
    loginWithGithub(registrationMode === 'invite-only' ? inviteCode : undefined);
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await authClient.requestPasswordReset({ email: forgotEmail, redirectTo: window.location.origin + '/reset-password' });
      setForgotSent(true);
    } catch {
      setForgotSent(true);
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    setError('');
    setTwoFactorRequired(false);
    setTotpCode('');
  };

  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src="/logo.png" alt="Kryton" className="h-12" />
        </div>

        {/* Card */}
        <div className="bg-surface-900 rounded-xl border border-gray-700/50 p-6">
          {/* Tabs */}
          <div className="flex mb-6 border-b border-gray-700/50">
            <button
              type="button"
              onClick={() => switchTab('signin')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${
                tab === 'signin'
                  ? 'text-violet-400 border-b-2 border-violet-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex-1 pb-3 text-sm font-medium transition-colors ${
                tab === 'register'
                  ? 'text-violet-400 border-b-2 border-violet-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Register
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* 2FA verification step */}
          {tab === 'signin' && twoFactorRequired && (
            <form onSubmit={handleTwoFactorVerify} className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-gray-300 font-medium">Two-Factor Authentication</p>
                <p className="text-xs text-gray-500 mt-1">
                  {useBackupCode
                    ? 'Enter one of your backup recovery codes.'
                    : 'Enter the 6-digit code from your authenticator app.'}
                </p>
              </div>
              <div>
                <input
                  type="text"
                  inputMode={useBackupCode ? 'text' : 'numeric'}
                  pattern={useBackupCode ? undefined : '[0-9]*'}
                  maxLength={useBackupCode ? 20 : 6}
                  value={totpCode}
                  onChange={e => setTotpCode(useBackupCode ? e.target.value : e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  placeholder={useBackupCode ? 'Enter backup code' : '000000'}
                  className={`w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 ${useBackupCode ? '' : 'tracking-widest text-center text-lg'}`}
                />
              </div>
              <button
                type="submit"
                disabled={loading || totpCode.length < (useBackupCode ? 1 : 6)}
                className="w-full rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-600 active:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
              <div className="flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => { setUseBackupCode(v => !v); setTotpCode(''); setError(''); }}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  {useBackupCode ? 'Use authenticator code' : 'Use backup code instead'}
                </button>
                <button
                  type="button"
                  onClick={() => { setTwoFactorRequired(false); setTotpCode(''); setError(''); }}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Back
                </button>
              </div>
            </form>
          )}

          {/* Sign In form */}
          {tab === 'signin' && !twoFactorRequired && !forgotMode && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="signin-email" className="block text-sm font-medium text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="signin-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="signin-password" className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  id="signin-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Enter your password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-600 active:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>

              {/* Passkey sign in */}
              <button
                type="button"
                onClick={handlePasskeySignIn}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-700/50 bg-surface-950 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z" />
                </svg>
                Sign in with Passkey
              </button>

              {smtpEnabled && (
                <button type="button" onClick={() => { setForgotMode(true); setForgotSent(false); setError(''); }}
                  className="w-full text-center text-xs text-violet-400 hover:text-violet-300 mt-2">
                  Forgot password?
                </button>
              )}
              {!smtpEnabled && (
                <p className="text-center text-xs text-gray-500 mt-2">
                  Forgot password? Contact your admin.
                </p>
              )}
            </form>
          )}

          {/* Forgot password form */}
          {tab === 'signin' && forgotMode && !twoFactorRequired && (
            <div className="mt-4 p-4 border border-gray-700/50 rounded-lg">
              <h4 className="text-sm font-medium text-gray-200 mb-2">Reset Password</h4>
              {forgotSent ? (
                <p className="text-xs text-green-400">If an account exists with that email, a reset link has been sent.</p>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-2">
                  <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required
                    placeholder="Enter your email" className="w-full bg-surface-950 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 bg-violet-500 text-white rounded-lg py-2 text-xs font-medium hover:bg-violet-600">Send Reset Link</button>
                    <button type="button" onClick={() => setForgotMode(false)} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Register form */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="reg-name" className="block text-sm font-medium text-gray-300 mb-1">
                  Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="reg-password" className="block text-sm font-medium text-gray-300 mb-1">
                  Password
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="Create a password"
                />
              </div>
              {registrationMode === 'invite-only' && (
                <div>
                  <label htmlFor="reg-invite" className="block text-sm font-medium text-gray-300 mb-1">
                    Invite Code
                  </label>
                  <input
                    id="reg-invite"
                    type="text"
                    required
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className="w-full rounded-lg border border-gray-700/50 bg-surface-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    placeholder="Enter your invite code"
                  />
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-600 active:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}

          {/* OAuth divider */}
          {(googleEnabled || githubEnabled) && <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700/50" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-surface-900 px-3 text-gray-500">or continue with</span>
            </div>
          </div>}

          {/* OAuth buttons -- only show if providers are configured */}
          {(googleEnabled || githubEnabled) && <div className="space-y-3">
            {googleEnabled && <button
              type="button"
              onClick={handleOAuthGoogle}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700/50 bg-surface-950 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-surface-800 transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </button>}
            {githubEnabled && <button
              type="button"
              onClick={handleOAuthGithub}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700/50 bg-surface-950 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-surface-800 transition-colors"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              Sign in with GitHub
            </button>}
          </div>}
        </div>
      </div>
    </div>
  );
}
