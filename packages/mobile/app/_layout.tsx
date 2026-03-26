import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Slot, useRouter, useSegments } from "expo-router";
import { AuthProvider, useAuthContext } from "../src/contexts/AuthContext";
import { colors } from "../src/lib/theme";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, serverUrl, twoFactorRequired } =
    useAuthContext();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inAppGroup = segments[0] === "(app)";

    if (twoFactorRequired) {
      if (segments[1] !== "two-factor") {
        router.replace("/(auth)/two-factor");
      }
      return;
    }

    if (!serverUrl) {
      if (!inAuthGroup || segments[1] !== "server") {
        router.replace("/(auth)/server");
      }
      return;
    }

    if (!isAuthenticated) {
      if (!inAuthGroup || segments[1] === "server") {
        router.replace("/(auth)/login");
      }
      return;
    }

    // Authenticated — send to app if still on auth screens
    if (inAuthGroup) {
      router.replace("/(app)/(tabs)/notes");
    }

    // If at root index, redirect to app
    if (!inAuthGroup && !inAppGroup && segments.length === 0) {
      router.replace("/(app)/(tabs)/notes");
    }
  }, [isAuthenticated, isLoading, serverUrl, twoFactorRequired, segments, router]);

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGuard>
        <Slot />
      </AuthGuard>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
