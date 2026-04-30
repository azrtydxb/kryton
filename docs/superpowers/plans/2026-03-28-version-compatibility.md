# Version Display & Mobile Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display version + commit in the web status bar, expose version info from the server API, and enforce major-version compatibility on the mobile app before syncing.

**Architecture:** The server reads version from root `package.json` and git commit hash at startup, caches them, and exposes via `GET /api/version` (unauthenticated). The web client fetches once on load and displays in the status bar. The mobile app checks major version compatibility before every sync and after login, hard-blocking on mismatch.

**Tech Stack:** Express.js (server), React (client), React Native/Expo (mobile), TypeScript throughout.

---

### Task 1: Server — version info module

**Files:**
- Create: `packages/server/src/lib/version.ts`

- [ ] **Step 1: Create the version module**

This module reads the version from root `package.json` and captures the git commit hash at import time. It caches both so they're only resolved once.

```typescript
// packages/server/src/lib/version.ts
import { execSync } from "child_process";
import { readFileSync } from "fs";
import * as path from "path";

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf-8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export const APP_VERSION = getVersion();
export const APP_COMMIT = getCommit();
export const APP_MAJOR_VERSION = parseInt(APP_VERSION.split(".")[0], 10) || 0;
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/lib/version.ts
git commit -m "feat(server): add version info module"
```

---

### Task 2: Server — version and health endpoints

**Files:**
- Modify: `packages/server/src/index.ts:262-265`

- [ ] **Step 1: Import version module and add the version endpoint**

At the top of `packages/server/src/index.ts`, add the import:

```typescript
import { APP_VERSION, APP_COMMIT, APP_MAJOR_VERSION } from "./lib/version.js";
```

Then replace the existing health endpoint block (lines 262-265):

```typescript
  // Health check (unauthenticated, GET-only)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
```

With:

```typescript
  // Version info (unauthenticated)
  app.get("/api/version", (_req, res) => {
    res.json({ version: APP_VERSION, commit: APP_COMMIT, majorVersion: APP_MAJOR_VERSION });
  });

  // Health check (unauthenticated, GET-only)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: APP_VERSION, commit: APP_COMMIT, majorVersion: APP_MAJOR_VERSION });
  });
```

- [ ] **Step 2: Verify the server starts and endpoints respond**

```bash
cd packages/server && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): add /api/version endpoint, add version info to /api/health"
```

---

### Task 3: Web client — display version in status bar

**Files:**
- Modify: `packages/client/src/components/StatusBar/StatusBar.tsx`

- [ ] **Step 1: Add version state and fetch to StatusBar**

Replace the entire contents of `packages/client/src/components/StatusBar/StatusBar.tsx` with:

```typescript
import { useEffect, useState } from 'react';

interface StatusBarProps {
  notePath: string | null;
  line: number;
  col: number;
  wordCount: number;
}

interface VersionInfo {
  version: string;
  commit: string;
}

export function StatusBar({ notePath, line, col, wordCount }: StatusBarProps) {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.version) {
          setVersionInfo({ version: data.version, commit: data.commit });
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-6 flex-shrink-0 flex items-center justify-between px-3 border-t border-gray-700/50 bg-surface-900 text-xs font-mono select-none">
      <div className="text-gray-400 truncate max-w-[40%]">
        {notePath || 'No file'}
      </div>
      <div className="flex items-center gap-3 text-gray-400">
        <span>{line}:{col}</span>
        <span>{wordCount.toLocaleString()} words</span>
        {versionInfo && (
          <span className="text-gray-500">
            v{versionInfo.version} · {versionInfo.commit}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the client builds**

```bash
cd packages/client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/StatusBar/StatusBar.tsx
git commit -m "feat(client): display version and commit hash in status bar"
```

---

### Task 4: Mobile — version constants and API method

**Files:**
- Create: `packages/mobile/src/lib/version.ts`
- Modify: `packages/mobile/src/lib/api.ts`

- [ ] **Step 1: Create the mobile version constants module**

The mobile app version comes from `app.json`. The commit hash is baked in via Expo's `extra` config (set at build time via `app.config.ts`).

```typescript
// packages/mobile/src/lib/version.ts
import Constants from "expo-constants";

export const APP_VERSION: string =
  Constants.expoConfig?.version ?? "0.0.0";

export const APP_COMMIT: string =
  (Constants.expoConfig?.extra?.commit as string) ?? "dev";

export const APP_MAJOR_VERSION: number =
  parseInt(APP_VERSION.split(".")[0], 10) || 0;
```

- [ ] **Step 2: Add `getServerVersion` to mobile API**

Add this interface above the `api` export in `packages/mobile/src/lib/api.ts`:

```typescript
export interface ServerVersionInfo {
  version: string;
  commit: string;
  majorVersion: number;
}
```

Add this method inside the `api` object at the end (before the closing `}`):

```typescript
  // Version
  getServerVersion: async (): Promise<ServerVersionInfo> => {
    const baseUrl = await getBaseUrl();
    const res = await fetch(`${baseUrl}/api/version`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error("Failed to fetch server version");
    }
    return res.json();
  },
```

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/src/lib/version.ts packages/mobile/src/lib/api.ts
git commit -m "feat(mobile): add version constants and getServerVersion API method"
```

---

### Task 5: Mobile — Expo config for build-time commit hash

**Files:**
- Create: `packages/mobile/app.config.ts`
- Modify: `packages/mobile/app.json`

- [ ] **Step 1: Create `app.config.ts` to inject commit hash at build time**

Expo supports `app.config.ts` which extends `app.json`. Create it:

```typescript
// packages/mobile/app.config.ts
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
```

- [ ] **Step 2: Verify it loads**

```bash
cd packages/mobile && npx expo config --type public 2>&1 | grep commit
```

Expected: `"commit": "<some hash>"`

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/app.config.ts
git commit -m "feat(mobile): inject git commit hash at build time via app.config.ts"
```

---

### Task 6: Mobile — version compatibility check

**Files:**
- Create: `packages/mobile/src/lib/versionCheck.ts`

- [ ] **Step 1: Create the version check module**

```typescript
// packages/mobile/src/lib/versionCheck.ts
import { api, ServerVersionInfo } from "./api";
import { APP_MAJOR_VERSION, APP_VERSION } from "./version";

export interface VersionCheckResult {
  compatible: boolean;
  serverVersion?: string;
  serverMajor?: number;
  clientVersion: string;
  clientMajor: number;
  message?: string;
}

export async function checkVersionCompatibility(): Promise<VersionCheckResult> {
  let serverInfo: ServerVersionInfo;
  try {
    serverInfo = await api.getServerVersion();
  } catch {
    // If the endpoint doesn't exist (old server), skip the check
    return {
      compatible: true,
      clientVersion: APP_VERSION,
      clientMajor: APP_MAJOR_VERSION,
    };
  }

  const compatible = serverInfo.majorVersion === APP_MAJOR_VERSION;

  if (compatible) {
    return {
      compatible: true,
      serverVersion: serverInfo.version,
      serverMajor: serverInfo.majorVersion,
      clientVersion: APP_VERSION,
      clientMajor: APP_MAJOR_VERSION,
    };
  }

  const message =
    serverInfo.majorVersion > APP_MAJOR_VERSION
      ? `Server version (v${serverInfo.version}) is incompatible with this app (v${APP_VERSION}). Please update your app.`
      : `Server version (v${serverInfo.version}) is incompatible with this app (v${APP_VERSION}). Please contact your admin to update the server.`;

  return {
    compatible: false,
    serverVersion: serverInfo.version,
    serverMajor: serverInfo.majorVersion,
    clientVersion: APP_VERSION,
    clientMajor: APP_MAJOR_VERSION,
    message,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mobile/src/lib/versionCheck.ts
git commit -m "feat(mobile): add version compatibility check module"
```

---

### Task 7: Mobile — integrate version check into AuthContext

**Files:**
- Modify: `packages/mobile/src/contexts/AuthContext.tsx`

- [ ] **Step 1: Add version incompatibility state and check after login**

Add import at the top of `packages/mobile/src/contexts/AuthContext.tsx`:

```typescript
import { checkVersionCompatibility } from "../lib/versionCheck";
```

Add to the `AuthContextValue` interface:

```typescript
  versionError: string | null;
```

Add state inside `AuthProvider`:

```typescript
  const [versionError, setVersionError] = useState<string | null>(null);
```

In the `login` callback, after `setIsAuthenticated(true)` (line 107), add the version check:

```typescript
        // Check version compatibility after login
        const versionResult = await checkVersionCompatibility();
        if (!versionResult.compatible) {
          setVersionError(versionResult.message ?? "Incompatible server version");
        }
```

In the `useEffect` that checks stored auth (the `checkAuth` function), after `setIsAuthenticated(true)` (line 55), add:

```typescript
          // Check version compatibility on app launch
          checkVersionCompatibility().then((result) => {
            if (!result.compatible) {
              setVersionError(result.message ?? "Incompatible server version");
            }
          });
```

Add `versionError` to the `value` object:

```typescript
    versionError,
```

In the `logout` callback, add:

```typescript
    setVersionError(null);
```

- [ ] **Step 2: Commit**

```bash
git add packages/mobile/src/contexts/AuthContext.tsx
git commit -m "feat(mobile): check version compatibility after login and on app launch"
```

---

### Task 8: Mobile — integrate version check into sync

**Files:**
- Modify: `packages/mobile/src/db/sync.ts`

- [ ] **Step 1: Add version check before sync operations**

Add import at the top of `packages/mobile/src/db/sync.ts`:

```typescript
import { checkVersionCompatibility } from "../lib/versionCheck";
```

At the very beginning of `syncWithServer()`, before any other logic (after line 6 `const lastPulledAt = ...`), add:

```typescript
  // Verify server version compatibility before syncing
  const versionResult = await checkVersionCompatibility();
  if (!versionResult.compatible) {
    throw new Error(versionResult.message ?? "Incompatible server version");
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/mobile/src/db/sync.ts
git commit -m "feat(mobile): block sync on version incompatibility"
```

---

### Task 9: Mobile — version incompatibility screen

**Files:**
- Modify: `packages/mobile/app/_layout.tsx`

- [ ] **Step 1: Add version error screen to the auth guard**

Read the current `_layout.tsx` to understand the `AuthGuard` component, then modify it to show a full-screen error when `versionError` is set.

Import the version constants at the top:

```typescript
import { APP_VERSION, APP_COMMIT } from "../src/lib/version";
```

In the `AuthGuard` component, destructure `versionError` from `useAuthContext()`:

```typescript
  const { isAuthenticated, isLoading, serverUrl, versionError, logout } = useAuthContext();
```

After the loading check and before the auth/server URL checks, add:

```typescript
  if (versionError) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0d1117", justifyContent: "center", alignItems: "center", padding: 32 }}>
        <Ionicons name="warning" size={64} color="#ef4444" />
        <Text style={{ color: "#ef4444", fontSize: 20, fontWeight: "700", marginTop: 16, textAlign: "center" }}>
          Version Incompatible
        </Text>
        <Text style={{ color: "#94a3b8", fontSize: 15, marginTop: 12, textAlign: "center", lineHeight: 22 }}>
          {versionError}
        </Text>
        <Text style={{ color: "#475569", fontSize: 13, marginTop: 24 }}>
          App: v{APP_VERSION} · {APP_COMMIT}
        </Text>
        <TouchableOpacity
          onPress={logout}
          style={{ marginTop: 32, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: "#1e293b", borderRadius: 8 }}
        >
          <Text style={{ color: "#e2e8f0", fontSize: 15 }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }
```

Make sure `TouchableOpacity`, `Ionicons`, and `Text` are imported (they likely already are from the existing layout code).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/mobile && npx tsc --noEmit 2>&1 | grep -E "version|_layout"
```

- [ ] **Step 3: Commit**

```bash
git add packages/mobile/app/_layout.tsx
git commit -m "feat(mobile): show version incompatibility screen when major versions mismatch"
```

---

### Task 10: Version bump and final build

**Files:**
- Modify: `package.json`, `packages/client/package.json`, `packages/server/package.json`, `packages/mobile/package.json`, `packages/mobile/app.json`

- [ ] **Step 1: Bump all versions to 4.2.0**

Update `"version": "4.1.0"` to `"version": "4.2.0"` in all five files:
- `package.json`
- `packages/client/package.json`
- `packages/server/package.json`
- `packages/mobile/package.json`
- `packages/mobile/app.json`

- [ ] **Step 2: Commit and push**

```bash
git add package.json packages/*/package.json packages/mobile/app.json
git commit -m "chore: bump all packages to v4.2.0"
git push
```

- [ ] **Step 3: Build mobile APK**

```bash
cd packages/mobile && EXPO_TOKEN=<token> npx eas build --platform android --profile preview --non-interactive
```
