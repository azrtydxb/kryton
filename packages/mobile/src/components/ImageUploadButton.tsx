import {
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useImagePicker } from "../hooks/useImagePicker";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { toast } from "../lib/toast";
import { colors, spacing, borderRadius } from "../lib/theme";

// A simple camera/image SVG-like icon rendered with Text — avoids a vector icon
// dependency. Replace with an icon library component if one is added later.
import { Text } from "react-native";

export interface ImageUploadButtonProps {
  onImageInserted: (markdownText: string) => void;
}

export function ImageUploadButton({ onImageInserted }: ImageUploadButtonProps) {
  const { pickImage, uploading } = useImagePicker();
  const { isOnline } = useNetworkStatus();

  const handlePress = async () => {
    if (!isOnline) {
      toast.info("Requires connection");
      return;
    }

    const markdown = await pickImage();
    if (markdown) {
      toast.success("Image uploaded");
      onImageInserted(markdown);
    }
  };

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={handlePress}
      disabled={uploading}
      accessibilityLabel="Insert image"
      accessibilityRole="button"
    >
      {uploading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={styles.icon}>&#128247;</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 36,
    minHeight: 36,
  },
  icon: {
    fontSize: 20,
    color: colors.textSecondary,
  },
});
