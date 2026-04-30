import { ExpoConfig, ConfigContext } from "expo/config";
import { execSync } from "child_process";

function getCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Kryton",
  slug: config.slug ?? "kryton",
  extra: {
    ...config.extra,
    commit: getCommit(),
  },
});
