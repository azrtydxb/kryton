import { createContext, useContext, useCallback, useMemo } from 'react';
import { authClient } from '../lib/auth-client';
import { useUIStore } from '../stores/uiStore';
import type { AuthUser } from '../lib/api';

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
  const session = authClient.useSession();
  const loading = session.isPending;

  const user: AuthUser | null = useMemo(() => {
    if (!session.data?.user) return null;
    const u = session.data.user;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: (u as Record<string, unknown>).role as string || 'user',
      avatarUrl: u.image ?? null,
    };
  }, [session.data]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      throw new Error(String(result.error.message) || 'Login failed');
    }
  }, []);

  const register = useCallback(async (email: string, password: string, name: string, inviteCode?: string) => {
    const result = await authClient.signUp.email({
      email,
      password,
      name,
      ...(inviteCode ? { inviteCode } : {}),
    } as Parameters<typeof authClient.signUp.email>[0]);
    if (result.error) {
      throw new Error(String(result.error.message) || 'Registration failed');
    }
  }, []);

  const loginWithGoogle = useCallback((inviteCode?: string) => {
    const callbackURL = window.location.origin;
    authClient.signIn.social({
      provider: "google",
      callbackURL,
      ...(inviteCode ? { inviteCode } : {}),
    } as Parameters<typeof authClient.signIn.social>[0]);
  }, []);

  const loginWithGithub = useCallback((inviteCode?: string) => {
    const callbackURL = window.location.origin;
    authClient.signIn.social({
      provider: "github",
      callbackURL,
      ...(inviteCode ? { inviteCode } : {}),
    } as Parameters<typeof authClient.signIn.social>[0]);
  }, []);

  const resetUI = useUIStore((s) => s.reset);
  const logout = useCallback(async () => {
    await authClient.signOut();
    resetUI();
  }, [resetUI]);

  const value = useMemo(() => ({
    user, loading, login, register, loginWithGoogle, loginWithGithub, logout,
  }), [user, loading, login, register, loginWithGoogle, loginWithGithub, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
