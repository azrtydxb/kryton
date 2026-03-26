// Re-export from AuthContext for ergonomic usage across the app.
// All components calling useAuth() share the same auth state via AuthProvider
// which is mounted at the root layout.
export { useAuthContext as useAuth } from "../contexts/AuthContext";
export type { AuthContextValue as UseAuthReturn } from "../contexts/AuthContext";
