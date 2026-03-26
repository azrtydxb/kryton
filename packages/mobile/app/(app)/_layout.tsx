import { useEffect } from "react";
import { Slot, useRouter } from "expo-router";
import { useAuthContext } from "../../src/contexts/AuthContext";

export default function AppLayout() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/(auth)/login");
    }
  }, [isAuthenticated, isLoading, router]);

  return <Slot />;
}
