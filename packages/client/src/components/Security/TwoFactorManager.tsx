import { useState, useEffect, useCallback, FormEvent } from 'react';
import { ShieldCheck, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';
import { authClient } from '../../lib/auth-client';
import {
  Section,
  Field,
  Toolbar,
  helpText,
  inputStyle,
  primaryBtn,
  ghostBtn,
  dangerBtn,
} from '../Settings/settings-kit';

type SetupStep = 'idle' | 'confirm-password' | 'scan-qr' | 'verify' | 'backup-codes';

// Small bg-2 chip matching the visual language of AppearanceSection pills.
const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 5,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--fg)',
} as const;

const dotStyle = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: 'var(--accent-good)',
} as const;

// QR wrapper: bg-2 padded container holds a white QR plate (must stay light
// for scanners). Mirrors the chip style at a larger scale.
const qrWrapStyle = {
  display: 'inline-block',
  padding: 12,
  background: 'var(--bg-2)',
  border: '1px solid var(--line)',
  borderRadius: 5,
} as const;

const qrPlateStyle = {
  display: 'inline-block',
  padding: 8,
  background: '#fff',
  borderRadius: 4,
} as const;

export function TwoFactorManager() {
  const session = authClient.useSession();
  const twoFactorEnabled = !!(session.data?.user as Record<string, unknown> | undefined)?.twoFactorEnabled;

  const [step, setStep] = useState<SetupStep>('idle');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpURI, setTotpURI] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Disable 2FA flow
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  useEffect(() => {
    if (totpURI) {
      QRCode.toDataURL(totpURI, { width: 200, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''));
    }
  }, [totpURI]);

  const handleStartSetup = useCallback(() => {
    setError('');
    setPassword('');
    setTotpCode('');
    setStep('confirm-password');
  }, []);

  const handleConfirmPassword = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        setError(result.error.message || 'Failed to start 2FA setup');
        return;
      }
      const { totpURI: uri, backupCodes: codes } = result.data!;
      setTotpURI(uri);
      setBackupCodes(codes);
      setStep('scan-qr');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start 2FA setup');
    } finally {
      setLoading(false);
    }
  }, [password]);

  const handleVerifyTOTP = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: totpCode });
      if (result.error) {
        setError(result.error.message || 'Invalid code. Please try again.');
        return;
      }
      setStep('backup-codes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }, [totpCode]);

  const handleDisable = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.twoFactor.disable({ password: disablePassword });
      if (result.error) {
        setError(result.error.message || 'Failed to disable 2FA');
        return;
      }
      setShowDisableConfirm(false);
      setDisablePassword('');
      await session.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA');
    } finally {
      setLoading(false);
    }
  }, [disablePassword, session]);

  const handleCopyBackupCodes = useCallback(() => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }, [backupCodes]);

  const handleFinish = useCallback(async () => {
    setStep('idle');
    setTotpURI('');
    setQrDataUrl('');
    setBackupCodes([]);
    setPassword('');
    setTotpCode('');
    await session.refetch();
  }, [session]);

  return (
    <Section title="two-factor authentication">
      <p style={helpText}>
        {twoFactorEnabled
          ? 'Your account is protected with TOTP two-factor authentication.'
          : 'Add an extra layer of security using an authenticator app.'}
      </p>

      {twoFactorEnabled && step === 'idle' && (
        <div style={{ marginBottom: 12 }}>
          <span style={chipStyle}>
            <span style={dotStyle} />
            <ShieldCheck size={14} style={{ color: 'var(--accent-good)' }} />
            2fa is enabled
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--accent-danger)',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Idle state */}
      {step === 'idle' && !twoFactorEnabled && (
        <Toolbar>
          <button onClick={handleStartSetup} style={primaryBtn}>
            Enable 2FA
          </button>
        </Toolbar>
      )}

      {step === 'idle' && twoFactorEnabled && !showDisableConfirm && (
        <Toolbar>
          <button
            onClick={() => { setShowDisableConfirm(true); setError(''); setDisablePassword(''); }}
            style={dangerBtn}
          >
            Disable 2FA
          </button>
        </Toolbar>
      )}

      {/* Disable confirm */}
      {showDisableConfirm && (
        <form onSubmit={handleDisable}>
          <p style={helpText}>Enter your password to confirm disabling 2FA.</p>
          <Field label="password">
            <input
              id="2fa-disable-password"
              type="password"
              value={disablePassword}
              onChange={e => setDisablePassword(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </Field>
          <Toolbar>
            <button type="submit" disabled={loading} style={{ ...dangerBtn, opacity: loading ? 0.5 : 1 }}>
              {loading ? 'Disabling...' : 'Confirm Disable'}
            </button>
            <button type="button" onClick={() => setShowDisableConfirm(false)} style={ghostBtn}>
              Cancel
            </button>
          </Toolbar>
        </form>
      )}

      {/* Step 1: Confirm password */}
      {step === 'confirm-password' && (
        <form onSubmit={handleConfirmPassword}>
          <p style={helpText}>Enter your password to begin setup.</p>
          <Field label="password">
            <input
              id="2fa-confirm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </Field>
          <Toolbar>
            <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.5 : 1 }}>
              {loading ? 'Generating...' : 'Continue'}
            </button>
            <button type="button" onClick={() => setStep('idle')} style={ghostBtn}>
              Cancel
            </button>
          </Toolbar>
        </form>
      )}

      {/* Step 2: Scan QR */}
      {step === 'scan-qr' && (
        <div>
          <p style={helpText}>
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).
          </p>
          {qrDataUrl ? (
            <div style={{ marginBottom: 12 }}>
              <span style={qrWrapStyle}>
                <span style={qrPlateStyle}>
                  <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} style={{ display: 'block' }} />
                </span>
              </span>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                borderRadius: 5,
                padding: 12,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--fg-3)',
                wordBreak: 'break-all',
                marginBottom: 12,
              }}
            >
              {totpURI}
            </div>
          )}
          <p style={helpText}>
            Can't scan? Manually enter the secret key from the URI above into your app.
          </p>
          <Toolbar>
            <button onClick={() => { setStep('verify'); setError(''); }} style={primaryBtn}>
              I've scanned it — Continue
            </button>
            <button type="button" onClick={() => setStep('idle')} style={ghostBtn}>
              Cancel
            </button>
          </Toolbar>
        </div>
      )}

      {/* Step 3: Verify TOTP */}
      {step === 'verify' && (
        <form onSubmit={handleVerifyTOTP}>
          <p style={helpText}>
            Enter the 6-digit code from your authenticator app to confirm setup.
          </p>
          <Field label="verification code">
            <input
              id="2fa-totp-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              placeholder="000000"
              style={{ ...inputStyle, letterSpacing: '0.3em', maxWidth: 180 }}
            />
          </Field>
          <Toolbar>
            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              style={{ ...primaryBtn, opacity: loading || totpCode.length !== 6 ? 0.5 : 1 }}
            >
              {loading ? 'Verifying...' : 'Verify & Enable'}
            </button>
            <button type="button" onClick={() => setStep('scan-qr')} style={ghostBtn}>
              Back
            </button>
          </Toolbar>
        </form>
      )}

      {/* Step 4: Backup codes */}
      {step === 'backup-codes' && (
        <div>
          <p style={{ ...helpText, color: 'var(--accent-warn)' }}>
            Save your backup codes. Store them in a safe place — each code can only be used once
            to recover access if you lose your authenticator.
          </p>
          <div
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: 12,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginBottom: 12,
            }}
          >
            {backupCodes.map((code, i) => (
              <span
                key={i}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--fg)',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 4,
                  padding: '4px 8px',
                }}
              >
                {code}
              </span>
            ))}
          </div>
          <Toolbar>
            <button onClick={handleFinish} style={primaryBtn}>
              I've saved them
            </button>
            <button
              onClick={handleCopyBackupCodes}
              style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {copiedCodes ? <Check size={12} /> : <Copy size={12} />}
              {copiedCodes ? 'Copied' : 'Copy codes'}
            </button>
          </Toolbar>
        </div>
      )}
    </Section>
  );
}
