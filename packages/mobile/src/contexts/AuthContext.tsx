import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { storage } from "../lib/storage";
import { api, AuthUser } from "../lib/api";

export interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  serverUrl: string | null;
  twoFactorRequired: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    inviteCode?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
  setServer: (url: string) => Promise<void>;
  submitTwoFactor: (code: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Pending credentials stored in memory while awaiting 2FA
let pendingTwoFactorCredentials: { email: string; password: string } | null =
  null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check stored credentials on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const [storedServerUrl, storedApiKey] = await Promise.all([
          storage.getServerUrl(),
          storage.getApiKey(),
        ]);
        setServerUrlState(storedServerUrl);
        if (storedApiKey && storedServerUrl) {
          setIsAuthenticated(true);
        }
      } catch {
        // Ignore SecureStore errors on first run
      } finally {
        setIsLoading(false);
      }
    }
    checkAuth();
  }, []);

  const setServer = useCallback(async (url: string) => {
    const normalized = url.replace(/\/$/, "");
    setError(null);
    try {
      const res = await fetch(`${normalized}/api/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error("Server returned an error response");
      }
      await storage.setServerUrl(normalized);
      setServerUrlState(normalized);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not reach server";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const result = await api.login(email, password);

      // Check for 2FA requirement
      if (
        result &&
        typeof result === "object" &&
        "twoFactorRequired" in result &&
        (result as { twoFactorRequired: boolean }).twoFactorRequired
      ) {
        pendingTwoFactorCredentials = { email, password };
        setTwoFactorRequired(true);
        return;
      }

      if (result.user) {
        await storage.setApiKey(result.token);
        setUser(result.user);
        setIsAuthenticated(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      throw new Error(message);
    }
  }, []);

  const register = useCallback(
    async (
      name: string,
      email: string,
      password: string,
      _inviteCode?: string
    ) => {
      setError(null);
      try {
        const result = await api.register(name, email, password);
        if (result.user) {
          await storage.setApiKey(result.token);
          setUser(result.user);
          setIsAuthenticated(true);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Registration failed";
        setError(message);
        throw new Error(message);
      }
    },
    []
  );

  const submitTwoFactor = useCallback(async (_code: string) => {
    setError(null);
    pendingTwoFactorCredentials = null;
    setTwoFactorRequired(false);
    setError("2FA not yet implemented on this server");
  }, []);

  const logout = useCallback(async () => {
    await storage.clearAuth();
    setIsAuthenticated(false);
    setUser(null);
    setTwoFactorRequired(false);
    pendingTwoFactorCredentials = null;
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    user,
    serverUrl,
    twoFactorRequired,
    error,
    login,
    register,
    logout,
    setServer,
    submitTwoFactor,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return ctx;
}
