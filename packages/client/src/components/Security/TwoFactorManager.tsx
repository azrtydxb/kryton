import { useState, useEffect, useCallback, FormEvent, CSSProperties } from 'react';
import { Shield, ShieldCheck, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';
import { authClient } from '../../lib/auth-client';

type SetupStep = 'idle' | 'confirm-password' | 'scan-qr' | 'verify' | 'backup-codes';

const inputStyle: CSSProperties = {
  background: 'var(--bg-2)',
  borderColor: 'var(--line)',
  color: 'var(--fg)',
};

const primaryBtnStyle: CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--accent-fg)',
};

const ghostBtnStyle: CSSProperties = {
  color: 'var(--fg-3)',
};

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

  const inputClass = "w-full border rounded-lg px-3 py-2 text-sm focus:outline-none";
  const btnPrimaryClass = "flex-1 rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50";
  const btnSecondaryClass = "px-4 py-2 text-sm transition-colors";

  return (
    <div className="max-w-sm space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1 flex items-center gap-2" style={{ color: 'var(--fg)' }}>
          {twoFactorEnabled
            ? <><ShieldCheck size={16} style={{ color: 'var(--accent-good)' }} /> Two-Factor Authentication</>
            : <><Shield size={16} style={{ color: 'var(--fg-3)' }} /> Two-Factor Authentication</>
          }
        </h3>
        <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
          {twoFactorEnabled
            ? 'Your account is protected with TOTP two-factor authentication.'
            : 'Add an extra layer of security using an authenticator app.'}
        </p>
      </div>

      {error && <div className="text-xs" style={{ color: 'var(--accent-danger)' }}>{error}</div>}

      {/* Idle state */}
      {step === 'idle' && !twoFactorEnabled && (
        <button onClick={handleStartSetup} className="rounded-lg px-4 py-2 text-sm font-medium transition-colors" style={primaryBtnStyle}>
          Enable 2FA
        </button>
      )}

      {step === 'idle' && twoFactorEnabled && !showDisableConfirm && (
        <button
          onClick={() => { setShowDisableConfirm(true); setError(''); setDisablePassword(''); }}
          className="border rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          style={{ borderColor: 'color-mix(in oklch, var(--accent-danger) 50%, transparent)', color: 'var(--accent-danger)' }}
        >
          Disable 2FA
        </button>
      )}

      {/* Disable confirm */}
      {showDisableConfirm && (
        <form onSubmit={handleDisable} className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--accent-warn)' }}>Enter your password to confirm disabling 2FA.</p>
          <div>
            <label htmlFor="2fa-disable-password" className="block text-xs mb-1" style={{ color: 'var(--fg-3)' }}>Password</label>
            <input
              id="2fa-disable-password"
              type="password"
              value={disablePassword}
              onChange={e => setDisablePassword(e.target.value)}
              required
              autoFocus
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className={btnPrimaryClass} style={primaryBtnStyle}>
              {loading ? 'Disabling...' : 'Confirm Disable'}
            </button>
            <button type="button" onClick={() => setShowDisableConfirm(false)} className={btnSecondaryClass} style={ghostBtnStyle}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Step 1: Confirm password to get TOTP URI */}
      {step === 'confirm-password' && (
        <form onSubmit={handleConfirmPassword} className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--fg-3)' }}>Enter your password to begin setup.</p>
          <div>
            <label htmlFor="2fa-confirm-password" className="block text-xs mb-1" style={{ color: 'var(--fg-3)' }}>Password</label>
            <input
              id="2fa-confirm-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoFocus
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className={btnPrimaryClass} style={primaryBtnStyle}>
              {loading ? 'Generating...' : 'Continue'}
            </button>
            <button type="button" onClick={() => setStep('idle')} className={btnSecondaryClass} style={ghostBtnStyle}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Step 2: Scan QR code */}
      {step === 'scan-qr' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).
          </p>
          {qrDataUrl ? (
            <div className="p-3 rounded-lg inline-block" style={{ background: 'var(--fg)' }}>
              <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} />
            </div>
          ) : (
            <div className="rounded-lg p-3 text-xs break-all" style={{ background: 'var(--bg-2)', color: 'var(--fg-3)' }}>
              {totpURI}
            </div>
          )}
          <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
            Can't scan? Manually enter the secret key from the URI above into your app.
          </p>
          <button
            onClick={() => { setStep('verify'); setError(''); }}
            className="w-full rounded-lg py-2 text-sm font-medium transition-colors"
            style={primaryBtnStyle}
          >
            I've scanned it — Continue
          </button>
          <button type="button" onClick={() => setStep('idle')} className="w-full text-center text-xs" style={ghostBtnStyle}>
            Cancel
          </button>
        </div>
      )}

      {/* Step 3: Verify TOTP code */}
      {step === 'verify' && (
        <form onSubmit={handleVerifyTOTP} className="space-y-3">
          <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
            Enter the 6-digit code from your authenticator app to confirm setup.
          </p>
          <div>
            <label htmlFor="2fa-totp-code" className="block text-xs mb-1" style={{ color: 'var(--fg-3)' }}>Authentication Code</label>
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
              className={inputClass + " tracking-widest text-center text-lg"}
              style={inputStyle}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading || totpCode.length !== 6} className={btnPrimaryClass} style={primaryBtnStyle}>
              {loading ? 'Verifying...' : 'Verify & Enable'}
            </button>
            <button type="button" onClick={() => setStep('scan-qr')} className={btnSecondaryClass} style={ghostBtnStyle}>
              Back
            </button>
          </div>
        </form>
      )}

      {/* Step 4: Backup codes */}
      {step === 'backup-codes' && (
        <div className="space-y-3">
          <div
            className="border rounded-lg p-3"
            style={{ background: 'color-mix(in oklch, var(--accent-warn) 10%, transparent)', borderColor: 'color-mix(in oklch, var(--accent-warn) 30%, transparent)' }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--accent-warn)' }}>Save your backup codes</p>
            <p className="text-xs" style={{ color: 'var(--accent-warn)' }}>
              Store these in a safe place. Each code can only be used once to recover access if you lose your authenticator.
            </p>
          </div>
          <div className="rounded-lg p-3 grid grid-cols-2 gap-1.5" style={{ background: 'var(--bg-2)' }}>
            {backupCodes.map((code, i) => (
              <span key={i} className="font-mono text-xs text-center py-1 rounded px-2" style={{ color: 'var(--fg)', background: 'var(--bg)' }}>
                {code}
              </span>
            ))}
          </div>
          <button
            onClick={handleCopyBackupCodes}
            className="flex items-center gap-2 text-xs transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            {copiedCodes ? <Check size={14} /> : <Copy size={14} />}
            {copiedCodes ? 'Copied!' : 'Copy all codes'}
          </button>
          <button
            onClick={handleFinish}
            className="w-full rounded-lg py-2 text-sm font-medium transition-colors"
            style={primaryBtnStyle}
          >
            Done — 2FA is enabled
          </button>
        </div>
      )}
    </div>
  );
}
