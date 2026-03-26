import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { api } from "../lib/api";

export interface UseImagePickerReturn {
  pickImage: () => Promise<string | null>;
  uploading: boolean;
  error: string | null;
}

export function useImagePicker(): UseImagePickerReturn {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async (): Promise<string | null> => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Photo library permission is required to upload images.");
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled) return null;

    setUploading(true);
    setError(null);
    try {
      const asset = result.assets[0];
      const filename = asset.uri.split("/").pop() || "image.jpg";
      const mimeType = asset.mimeType || "image/jpeg";

      const response = await api.uploadFile(asset.uri, filename, mimeType);
      return `![image](${response.path})`;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Image upload failed";
      setError(message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { pickImage, uploading, error };
}
