import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { colors, spacing, fontSize, borderRadius } from "../../src/lib/theme";

export default function TwoFactorScreen() {
  const { submitTwoFactor, error, clearError } = useAuth();
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError || error;

  async function handleVerify() {
    const trimmed = code.trim();
    const expectedLength = useBackupCode ? 0 : 6;
    if (!useBackupCode && trimmed.length !== 6) {
      setLocalError("Please enter a 6-digit code");
      return;
    }
    if (useBackupCode && !trimmed) {
      setLocalError("Please enter your backup code");
      return;
    }
    setLocalError(null);
    clearError();
    setLoading(true);
    try {
      await submitTwoFactor(trimmed);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Verification failed"
      );
    } finally {
      setLoading(false);
    }
    // suppress unused variable warning
    void expectedLength;
  }

  function handleToggleBackup() {
    setUseBackupCode((prev) => !prev);
    setCode("");
    setLocalError(null);
    clearError();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Two-Factor Authentication</Text>
          <Text style={styles.subtitle}>
            {useBackupCode
              ? "Enter one of your backup codes"
              : "Enter the 6-digit code from your authenticator app"}
          </Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, !useBackupCode && styles.codeInput]}
            value={code}
            onChangeText={(text) => {
              setCode(useBackupCode ? text : text.replace(/\D/g, "").slice(0, 6));
              setLocalError(null);
              clearError();
            }}
            placeholder={useBackupCode ? "backup-code-xxxx" : "000000"}
            placeholderTextColor={colors.textMuted}
            keyboardType={useBackupCode ? "default" : "number-pad"}
            maxLength={useBackupCode ? undefined : 6}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleVerify}
          />

          {displayError ? (
            <Text style={styles.errorText}>{displayError}</Text>
          ) : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleVerify}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toggleButton}
            onPress={handleToggleBackup}
          >
            <Text style={styles.toggleText}>
              {useBackupCode
                ? "Use authenticator code instead"
                : "Use backup code"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 100,
  },
  header: {
    marginBottom: spacing.xxl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  form: {
    gap: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
  },
  codeInput: {
    textAlign: "center",
    fontSize: fontSize.xxl,
    letterSpacing: 8,
    fontWeight: "600",
  },
  errorText: {
    color: colors.error,
    fontSize: fontSize.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  toggleButton: {
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  toggleText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
});
