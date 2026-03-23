import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi, setAccessToken, AuthUser } from '../lib/api';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, inviteCode?: string) => Promise<void>;
  loginWithGoogle: (inviteCode?: string) => void;
  loginWithGithub: (inviteCode?: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Schedule auto-refresh 14 minutes after last token
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      const result = await authApi.refresh();
      if (result) {
        setAccessToken(result.accessToken);
        setUser(result.user);
        scheduleRefresh();
      } else {
        setAccessToken(null);
        setUser(null);
      }
    }, 14 * 60 * 1000); // 14 minutes
  }, []);

  // On mount: try refresh to restore session
  useEffect(() => {
    authApi.refresh().then(result => {
      if (result) {
        setAccessToken(result.accessToken);
        setUser(result.user);
        scheduleRefresh();
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    // Also handle ?auth=success from OAuth redirect
    const params = new URLSearchParams(window.location.search);
    if (params.has('auth')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, [scheduleRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    setAccessToken(result.accessToken);
    setUser(result.user);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const register = useCallback(async (email: string, password: string, name: string, inviteCode?: string) => {
    const result = await authApi.register({ email, password, name, inviteCode });
    setAccessToken(result.accessToken);
    setUser(result.user);
    scheduleRefresh();
  }, [scheduleRefresh]);

  const loginWithGoogle = useCallback((inviteCode?: string) => {
    const url = inviteCode ? `/api/auth/google?inviteCode=${encodeURIComponent(inviteCode)}` : '/api/auth/google';
    window.location.href = url;
  }, []);

  const loginWithGithub = useCallback((inviteCode?: string) => {
    const url = inviteCode ? `/api/auth/github?inviteCode=${encodeURIComponent(inviteCode)}` : '/api/auth/github';
    window.location.href = url;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setAccessToken(null);
    setUser(null);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithGoogle, loginWithGithub, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
