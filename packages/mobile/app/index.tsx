import { View, Text, StyleSheet } from "react-native";
import { colors, fontSize } from "../src/lib/theme";

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kryton</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: "bold",
  },
});
