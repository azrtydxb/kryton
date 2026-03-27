import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { getDatabase, SettingRow } from "../db";
import { colors, spacing, fontSize } from "../lib/theme";

interface FavoriteItem {
  path: string;
  name: string;
}

function parseFavorites(setting: SettingRow | null): FavoriteItem[] {
  if (!setting) return [];
  try {
    const paths: string[] = JSON.parse(setting.value);
    return paths.map((p) => ({
      path: p,
      name: p.split("/").pop()?.replace(/\.md$/, "") ?? p,
    }));
  } catch {
    return [];
  }
}

export function FavoritesSection() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const db = getDatabase();
    const rows = db.getAllSync<SettingRow>(
      "SELECT * FROM settings WHERE _status != 'deleted'"
    );
    const starredSetting = rows.find((r) => r.key === "starred") ?? null;
    setFavorites(parseFavorites(starredSetting));
  }, []);

  if (favorites.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Favorites</Text>
      {favorites.map((item) => (
        <TouchableOpacity
          key={item.path}
          style={styles.item}
          onPress={() =>
            router.push(
              `/(app)/note/${encodeURIComponent(item.path)}` as `/${string}`
            )
          }
          activeOpacity={0.7}
        >
          <Text style={styles.starIcon}>★</Text>
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  starIcon: {
    color: colors.star,
    fontSize: fontSize.md,
  },
  itemName: {
    color: colors.text,
    fontSize: fontSize.md,
    flex: 1,
  },
});
