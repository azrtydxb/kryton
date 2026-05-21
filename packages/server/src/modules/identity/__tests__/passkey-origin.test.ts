import { describe, it, expect } from "vitest";
import { buildPasskeyOrigins } from "../auth-config.js";

describe("buildPasskeyOrigins", () => {
  it("returns only the web origin when no mobile env vars are set", () => {
    const origins = buildPasskeyOrigins({ APP_URL: "https://kryton.example.com" });
    expect(origins).toEqual(["https://kryton.example.com"]);
  });

  it("includes ios:bundle-id origin when MOBILE_IOS_BUNDLE_ID is set", () => {
    const origins = buildPasskeyOrigins({
      APP_URL: "https://kryton.example.com",
      MOBILE_IOS_BUNDLE_ID: "com.kryton.mobile",
    });
    expect(origins).toEqual([
      "https://kryton.example.com",
      "ios:bundle-id:com.kryton.mobile",
    ]);
  });

  it("includes android:apk-key-hash origin when MOBILE_ANDROID_APK_KEY_HASH is set", () => {
    const origins = buildPasskeyOrigins({
      APP_URL: "https://kryton.example.com",
      MOBILE_ANDROID_APK_KEY_HASH: "abc123base64url",
    });
    expect(origins).toEqual([
      "https://kryton.example.com",
      "android:apk-key-hash:abc123base64url",
    ]);
  });

  it("includes all three origins when both mobile env vars are set", () => {
    const origins = buildPasskeyOrigins({
      APP_URL: "https://kryton.example.com",
      MOBILE_IOS_BUNDLE_ID: "com.kryton.mobile",
      MOBILE_ANDROID_APK_KEY_HASH: "abc123base64url",
    });
    expect(origins).toEqual([
      "https://kryton.example.com",
      "ios:bundle-id:com.kryton.mobile",
      "android:apk-key-hash:abc123base64url",
    ]);
  });

  it("falls back to localhost origin when APP_URL is not set", () => {
    const origins = buildPasskeyOrigins({});
    expect(origins).toEqual(["http://localhost:5173"]);
  });
});
