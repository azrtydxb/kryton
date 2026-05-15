import { useState, useEffect, type FormEvent, type CSSProperties, type ReactNode, type InputHTMLAttributes } from 'react';
import { KRYTON_UI_VERSION } from '@azrtydxb/ui';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { Icons } from '../components/Icons';

type Tab = 'signin' | 'register';

const monoFamily = 'var(--font-mono)';
const displayFamily = 'var(--font-display)';

const labelStyle: CSSProperties = {
  fontFamily: monoFamily,
  fontSize: 11,
  color: 'var(--fg-3)',
  letterSpacing: '0.06em',
  textTransform: 'lowercase',
};

const inputBaseStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 6,
  background: 'var(--bg-input)',
  border: '1px solid var(--line)',
  color: 'var(--fg)',
  fontSize: 13,
  fontFamily: monoFamily,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function applyFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = 'var(--accent)';
  e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)';
}
function applyBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = 'var(--line)';
  e.currentTarget.style.boxShadow = 'none';
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'style'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function Field({ label, value, onChange, ...rest }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={labelStyle}>{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputBaseStyle}
        onFocus={applyFocus}
        onBlur={applyBlur}
      />
    </label>
  );
}

const primaryBtnStyle: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 6,
  background: 'var(--accent)',
  color: '#fff',
  fontFamily: monoFamily,
  fontSize: 12.5,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  border: 'none',
  cursor: 'pointer',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const secondaryBtnStyle: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 6,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  color: 'var(--fg-1)',
  fontFamily: monoFamily,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  cursor: 'pointer',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

function PrimaryButton({ disabled, children, type = 'submit', onClick }: { disabled?: boolean; children: ReactNode; type?: 'button' | 'submit'; onClick?: () => void }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...primaryBtnStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ disabled, children, onClick, type = 'button' }: { disabled?: boolean; children: ReactNode; onClick?: () => void; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...secondaryBtnStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  );
}

export default function LoginPage() {
  const { login, register, loginWithGoogle, loginWithGithub } = useAuth();

  const [tab, setTab] = useState<Tab>('signin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationMode, setRegistrationMode] = useState<string>('open');

  // 2FA state
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
    setForgotMode(false);
  };

  const eyebrow = tab === 'signin' ? '// authenticate' : '// register';
  const heading = tab === 'signin' ? 'Welcome back' : 'Create your account';

  return (
    <div
      className="bg-grid"
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        position: 'relative',
        overflow: 'hidden',
        padding: '24px 16px',
      }}
    >
      {/* glow orb */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)',
          top: -200,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ width: 380, maxWidth: '100%', position: 'relative', zIndex: 1 }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          <Icons.Logo size={32} />
          <span style={{ fontFamily: displayFamily, fontSize: 24, fontWeight: 600, color: 'var(--fg)', letterSpacing: -0.4 }}>
            kryton
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: 28,
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {/* Eyebrow */}
          <div
            style={{
              fontFamily: monoFamily,
              fontSize: 11,
              color: 'var(--fg-4)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            {eyebrow}
          </div>

          {/* Heading */}
          <h2
            style={{
              margin: 0,
              fontFamily: displayFamily,
              fontSize: 22,
              color: 'var(--fg)',
              letterSpacing: -0.3,
              marginBottom: 22,
              fontWeight: 600,
            }}
          >
            {heading}
          </h2>

          {/* Tab strip */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid var(--line)' }}>
            {(['signin', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  fontSize: 12,
                  fontFamily: monoFamily,
                  background: 'transparent',
                  cursor: 'pointer',
                  color: tab === t ? 'var(--accent)' : 'var(--fg-3)',
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {t === 'signin' ? 'sign in' : 'register'}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                marginBottom: 14,
                padding: '8px 10px',
                border: '1px solid var(--accent-danger)',
                background: 'oklch(0.7 0.2 25 / 0.12)',
                borderRadius: 6,
                color: 'var(--accent-danger)',
                fontFamily: monoFamily,
                fontSize: 11.5,
              }}
            >
              {error}
            </div>
          )}

          {/* 2FA */}
          {tab === 'signin' && twoFactorRequired && (
            <form onSubmit={handleTwoFactorVerify} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ ...labelStyle, textTransform: 'uppercase', color: 'var(--fg-4)', letterSpacing: '0.08em', marginBottom: 4 }}>
                  // two-factor
                </div>
                <div style={{ fontFamily: monoFamily, fontSize: 12, color: 'var(--fg-2)' }}>
                  {useBackupCode ? 'enter one of your backup codes' : 'enter the 6-digit code from your authenticator'}
                </div>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>{useBackupCode ? 'backup code' : 'code'}</span>
                <input
                  type="text"
                  inputMode={useBackupCode ? 'text' : 'numeric'}
                  pattern={useBackupCode ? undefined : '[0-9]*'}
                  maxLength={useBackupCode ? 20 : 6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(useBackupCode ? e.target.value : e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  placeholder={useBackupCode ? 'enter backup code' : '000000'}
                  style={{
                    ...inputBaseStyle,
                    letterSpacing: useBackupCode ? 'normal' : '0.4em',
                    textAlign: useBackupCode ? 'left' : 'center',
                    fontSize: useBackupCode ? 13 : 16,
                  }}
                  onFocus={applyFocus}
                  onBlur={applyBlur}
                />
              </label>
              <PrimaryButton disabled={loading || totpCode.length < (useBackupCode ? 1 : 6)}>
                {loading ? 'verifying…' : 'verify'}
              </PrimaryButton>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: monoFamily, fontSize: 11 }}>
                <button
                  type="button"
                  onClick={() => { setUseBackupCode((v) => !v); setTotpCode(''); setError(''); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontFamily: monoFamily, fontSize: 11, textDecoration: 'underline', textDecorationStyle: 'dashed', textUnderlineOffset: 3 }}
                >
                  {useBackupCode ? 'use authenticator code' : 'use backup code'}
                </button>
                <button
                  type="button"
                  onClick={() => { setTwoFactorRequired(false); setTotpCode(''); setError(''); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--fg-4)', cursor: 'pointer', fontFamily: monoFamily, fontSize: 11 }}
                >
                  back
                </button>
              </div>
            </form>
          )}

          {/* Sign In */}
          {tab === 'signin' && !twoFactorRequired && !forgotMode && (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="email" type="email" required value={email} onChange={setEmail} placeholder="you@example.com" />
              <Field label="password" type="password" required value={password} onChange={setPassword} placeholder="••••••••••••" />

              <PrimaryButton disabled={loading}>
                {loading ? 'signing in…' : 'sign in'}
                <Icons.Chevron size={12} />
              </PrimaryButton>

              {/* OR divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontFamily: monoFamily, fontSize: 10.5, color: 'var(--fg-4)', letterSpacing: '0.08em' }}>OR</span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>

              <SecondaryButton onClick={handlePasskeySignIn} disabled={loading}>
                <Icons.Sparkle size={13} style={{ color: 'var(--accent)' }} />
                continue with passkey
              </SecondaryButton>

              {googleEnabled && (
                <SecondaryButton onClick={handleOAuthGoogle} disabled={loading}>
                  continue with google
                </SecondaryButton>
              )}
              {githubEnabled && (
                <SecondaryButton onClick={handleOAuthGithub} disabled={loading}>
                  continue with github
                </SecondaryButton>
              )}

              {smtpEnabled ? (
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setForgotSent(false); setError(''); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: monoFamily, fontSize: 11, color: 'var(--fg-3)', textAlign: 'center', textDecoration: 'underline', textDecorationStyle: 'dashed', textUnderlineOffset: 3 }}
                >
                  forgot password?
                </button>
              ) : (
                <p style={{ margin: 0, textAlign: 'center', fontFamily: monoFamily, fontSize: 11, color: 'var(--fg-4)' }}>
                  forgot password? contact your admin.
                </p>
              )}
            </form>
          )}

          {/* Forgot password */}
          {tab === 'signin' && forgotMode && !twoFactorRequired && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ ...labelStyle, textTransform: 'uppercase', color: 'var(--fg-4)', letterSpacing: '0.08em' }}>
                // reset password
              </div>
              {forgotSent ? (
                <p style={{ margin: 0, fontFamily: monoFamily, fontSize: 12, color: 'var(--accent-good)' }}>
                  if an account exists with that email, a reset link has been sent.
                </p>
              ) : (
                <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field label="email" type="email" required value={forgotEmail} onChange={setForgotEmail} placeholder="you@example.com" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <PrimaryButton>send reset link</PrimaryButton>
                  </div>
                </form>
              )}
              <button
                type="button"
                onClick={() => setForgotMode(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: monoFamily, fontSize: 11, color: 'var(--fg-3)', textAlign: 'center' }}
              >
                back to sign in
              </button>
            </div>
          )}

          {/* Register */}
          {tab === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="name" type="text" required value={regName} onChange={setRegName} placeholder="your name" />
              <Field label="email" type="email" required value={regEmail} onChange={setRegEmail} placeholder="you@example.com" />
              <Field label="password" type="password" required value={regPassword} onChange={setRegPassword} placeholder="create a password" />
              {registrationMode === 'invite-only' && (
                <Field label="invite code" type="text" required value={inviteCode} onChange={setInviteCode} placeholder="enter your invite code" />
              )}
              <PrimaryButton disabled={loading}>
                {loading ? 'creating account…' : 'create account'}
                <Icons.Chevron size={12} />
              </PrimaryButton>

              {(googleEnabled || githubEnabled) && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0' }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                    <span style={{ fontFamily: monoFamily, fontSize: 10.5, color: 'var(--fg-4)', letterSpacing: '0.08em' }}>OR</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                  </div>
                  {googleEnabled && (
                    <SecondaryButton onClick={handleOAuthGoogle} disabled={loading}>
                      continue with google
                    </SecondaryButton>
                  )}
                  {githubEnabled && (
                    <SecondaryButton onClick={handleOAuthGithub} disabled={loading}>
                      continue with github
                    </SecondaryButton>
                  )}
                </>
              )}
            </form>
          )}

          {/* Footer */}
          <div
            style={{
              marginTop: 20,
              paddingTop: 14,
              borderTop: '1px dashed var(--line)',
              fontFamily: monoFamily,
              fontSize: 11.5,
              color: 'var(--fg-4)',
              textAlign: 'center',
            }}
          >
            self-hosted · your notes, your server
          </div>
        </div>

        {/* Status row */}
        <div
          style={{
            marginTop: 18,
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            fontFamily: monoFamily,
            fontSize: 11,
            color: 'var(--fg-3)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="dot pulse" style={{ background: 'var(--accent-good)' }} />
            server online
          </span>
          <span style={{ color: 'var(--fg-4)' }}>v{KRYTON_UI_VERSION}</span>
        </div>
      </div>
    </div>
  );
}
