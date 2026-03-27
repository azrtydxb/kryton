import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, fontSize } from "../../../src/lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

interface TabConfig {
  name: string;
  title: string;
  icon: IoniconName;
  iconActive: IoniconName;
}

const TABS: TabConfig[] = [
  {
    name: "notes",
    title: "Notes",
    icon: "document-text-outline",
    iconActive: "document-text",
  },
  {
    name: "search",
    title: "Search",
    icon: "search-outline",
    iconActive: "search",
  },
  {
    name: "graph",
    title: "Graph",
    icon: "git-network-outline",
    iconActive: "git-network",
  },
  {
    name: "tags",
    title: "Tags",
    icon: "pricetag-outline",
    iconActive: "pricetag",
  },
  {
    name: "settings",
    title: "Settings",
    icon: "settings-outline",
    iconActive: "settings",
  },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          fontSize: fontSize.xs,
          fontWeight: "500",
        },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons
                name={focused ? tab.iconActive : tab.icon}
                size={size}
                color={color}
              />
            ),
          }}
        />
      ))}
      {/* Note screen lives inside tabs so the tab bar stays visible */}
      <Tabs.Screen
        name="note/[...path]"
        options={{ href: null }}
      />
    </Tabs>
  );
}
