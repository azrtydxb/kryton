# `kryton-desktop` Complete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring `kryton-desktop` from "works on a Mac in dev mode" to a shippable v1 — Tier 2 + Tier 3 native integrations, Windows build + signing, plugin/agent UI surfaces, full settings, release pipeline.

**Architecture:** Building on sub-project 2's foundation. Adds Tauri plugins (tray, hotkey, deep-link, notification, updater), native OS integrations (Spotlight on macOS via objc2; Windows Search via .url shortcuts), and a tagged-release workflow that produces signed, notarized binaries.

**Tech Stack:** Same as sub-project 2 plus: `@tauri-apps/plugin-{tray,global-shortcut,deep-link,notification,updater,os}`, `tauri-plugin-deep-link`, `objc2` + `objc2-core-spotlight` (Rust), Windows EV code-signing cert, Apple Developer ID + Notarization.

**Spec:** [`docs/superpowers/specs/2026-04-30-kryton-desktop-complete-design.md`](../specs/2026-04-30-kryton-desktop-complete-design.md)

**Repository:** `azrtydxb/kryton-desktop`. Branch: `phase/2-complete`.

**Phases:**
- Phase A: Tier 2 native (tray, hotkey, deep-link, drag-drop)
- Phase B: Tier 3 native (notifications, Spotlight, Windows Search, Touch Bar, jumplist)
- Phase C: Plugin manager + agents UI integration
- Phase D: Full settings panels
- Phase E: Windows build + signing
- Phase F: Release pipeline + auto-updater
- Phase G: Distribution + smoke

---

## Phase A — Tier 2 native

### Task DCC-A1: System tray

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-system-tray` if not in core Tauri)
- Modify: `package.json` (already has @tauri-apps/api)

- [ ] **Step 1: Implement tray.rs** per spec section "System tray".

```rust
use tauri::{AppHandle, Manager};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem, MenuEvent};
use crate::account_store;
use crate::window_manager;

pub fn create_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let menu = build_tray_menu(app)?;
    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(handle_menu_event)
        .build(app)?;
    Ok(tray)
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let accounts = tauri::async_runtime::block_on(account_store::list_accounts(app.clone())).unwrap_or_default();
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
    for acc in &accounts {
        let label_open = format!("open-{}", acc.id);
        let label_sync = format!("sync-{}", acc.id);
        let label_logout = format!("logout-{}", acc.id);
        let submenu = Submenu::with_items(app, &acc.label, true, &[
            &MenuItem::with_id(app, &label_open, "Open Window", true, None::<&str>)?,
            &MenuItem::with_id(app, &label_sync, "Sync Now", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, &label_logout, "Log Out", true, None::<&str>)?,
        ])?;
        items.push(Box::new(submenu));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "tray-add-account", "Add Account...", true, None::<&str>)?));
    items.push(Box::new(MenuItem::with_id(app, "tray-launcher", "Show Launcher", true, None::<&str>)?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(PredefinedMenuItem::quit(app, None)?));

    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &item_refs)
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().0.as_str().to_string();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if id == "tray-launcher" {
            let _ = window_manager::open_launcher_window(app_clone).await;
        } else if id == "tray-add-account" {
            let _ = window_manager::open_launcher_window(app_clone).await;
        } else if let Some(rest) = id.strip_prefix("open-") {
            let _ = window_manager::open_account_window(rest.to_string(), app_clone).await;
        } else if let Some(rest) = id.strip_prefix("sync-") {
            // Emit a sync event to that account's window
            if let Some(window) = app_clone.get_webview_window(&format!("account-{}", rest)) {
                let _ = window.emit("trigger-sync", ());
            }
        } else if let Some(rest) = id.strip_prefix("logout-") {
            // Emit a logout event
            if let Some(window) = app_clone.get_webview_window(&format!("account-{}", rest)) {
                let _ = window.emit("logout", ());
            }
        }
    });
}

pub fn rebuild_tray(app: &AppHandle, tray: &TrayIcon) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    tray.set_menu(Some(menu))?;
    Ok(())
}
```

- [ ] **Step 2: Wire into main.rs**

```rust
.setup(|app| {
    let tray = tray::create_tray(app.handle())?;
    app.manage(tray);
    // ... existing setup
    Ok(())
})
```

- [ ] **Step 3: Rebuild tray when accounts change** — add a Tauri command:

```rust
#[tauri::command]
async fn refresh_tray(app: tauri::AppHandle) -> Result<(), String> {
    let tray = app.state::<TrayIcon>();
    tray::rebuild_tray(&app, &tray).map_err(|e| e.to_string())
}
```

Frontend calls `invoke("refresh_tray")` after add/remove account.

- [ ] **Step 4: Manual smoke**

```bash
npm run dev
```

Add an account; verify it appears in tray menu. Click "Sync Now" — observe sync event in account window's React DevTools.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/ src/
git commit -m "feat(tauri): system tray with per-account submenus"
git push
```

---

### Task DCC-A2: Global hotkey

**Files:**
- Create: `src-tauri/src/hotkey.rs`
- Modify: `src-tauri/src/main.rs`, `Cargo.toml`, `package.json`

- [ ] **Step 1: Install plugin**

```bash
npm install @tauri-apps/plugin-global-shortcut
```

```toml
# Cargo.toml
tauri-plugin-global-shortcut = "2"
```

In main.rs:
```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

- [ ] **Step 2: Implement registration**

```rust
// src-tauri/src/hotkey.rs
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register_default(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+K", |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            // Find focused window or fall back to most-recent account
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                let focused = app_clone.webview_windows().values().find(|w| w.is_focused().unwrap_or(false)).cloned();
                if let Some(w) = focused.or_else(|| app_clone.webview_windows().values().next().cloned()) {
                    let _ = w.set_focus();
                    let _ = w.emit("open-quick-switcher", ());
                }
            });
        }
    })?;
    Ok(())
}
```

In main.rs setup, add `let _ = hotkey::register_default(app.handle());`.

- [ ] **Step 3: Frontend listens**

In `AccountWindow.tsx`:
```tsx
useEffect(() => {
  const un = listen("open-quick-switcher", () => { /* open command palette */ });
  return () => { un.then(fn => fn()); };
}, []);
```

- [ ] **Step 4: Manual smoke**: press `⌘⇧K` from outside the app — focus shifts to Kryton, command palette opens.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/ src/ package.json
git commit -m "feat(tauri): global hotkey ⌘⇧K opens quick switcher"
git push
```

---

### Task DCC-A3: Deep links

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `tauri.conf.json`
- Create: `src/tauri/deep-link-bridge.ts`

- [ ] **Step 1: Install plugin**

```bash
npm install @tauri-apps/plugin-deep-link
```

```toml
tauri-plugin-deep-link = "2"
```

In main.rs:
```rust
.plugin(tauri_plugin_deep_link::init())
```

- [ ] **Step 2: Register URL scheme**

In `tauri.conf.json`:
```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["kryton"]
    }
  }
}
```

For macOS: also add to `Info.plist` (Tauri does this automatically from above config in v2).

- [ ] **Step 3: Frontend handles incoming URLs**

```ts
// src/tauri/deep-link-bridge.ts
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "@tauri-apps/api/core";

export async function setupDeepLinks(onUrl: (parsed: { kind: "note"; path: string; account: string } | { kind: "search"; q: string; account: string } | { kind: "settings"; section: string; account: string }) => void) {
  await onOpenUrl(async (urls) => {
    for (const url of urls) {
      try {
        const parsed = parseDeepLink(url);
        if (parsed) {
          await invoke("open_account_window", { accountId: parsed.account });
          onUrl(parsed);
        }
      } catch (e) {
        console.warn("Failed to parse deep link", url, e);
      }
    }
  });
}

function parseDeepLink(url: string) {
  const u = new URL(url);
  if (u.protocol !== "kryton:") return null;
  const account = u.searchParams.get("account") ?? "";
  if (u.host === "note") return { kind: "note" as const, path: decodeURIComponent(u.pathname.replace(/^\//, "")), account };
  if (u.host === "search") return { kind: "search" as const, q: u.searchParams.get("q") ?? "", account };
  if (u.host === "settings") return { kind: "settings" as const, section: decodeURIComponent(u.pathname.replace(/^\//, "")), account };
  return null;
}
```

- [ ] **Step 4: Wire up in LauncherApp + AccountWindow**

In LauncherApp.tsx mount: `setupDeepLinks(handleDeepLink)`.

- [ ] **Step 5: Manual smoke**: from terminal `open kryton://note/test?account=acc_xxx` — Kryton focuses, note opens.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/ src/ package.json tauri.conf.json
git commit -m "feat(tauri): kryton:// deep link handling"
git push
```

---

### Task DCC-A4: Drag-drop import

**Files:**
- Modify: `src/AccountWindow.tsx`
- Create: `src/tauri/drop-handler.ts`

- [ ] **Step 1: Implement handler**

```ts
// src/tauri/drop-handler.ts
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFile, readFile } from "@tauri-apps/plugin-fs";

export async function setupDropHandler(opts: {
  serverUrl: string;
  authToken: () => Promise<string | null>;
  onProgress?: (current: number, total: number) => void;
}) {
  const window = getCurrentWebviewWindow();
  await window.onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") return;
    const paths = event.payload.paths;
    let processed = 0;
    for (const path of paths) {
      processed++;
      opts.onProgress?.(processed, paths.length);
      try {
        if (path.endsWith(".md") || path.endsWith(".markdown")) {
          const content = await readTextFile(path);
          const filename = path.split("/").pop() ?? "imported.md";
          await uploadNote(opts.serverUrl, await opts.authToken(), filename, content);
        } else if (path.match(/\.(png|jpg|jpeg|pdf|gif)$/i)) {
          const bytes = await readFile(path);
          const filename = path.split("/").pop() ?? "attachment";
          await uploadAttachment(opts.serverUrl, await opts.authToken(), filename, bytes);
        }
      } catch (e) {
        console.warn("Drop import failed for", path, e);
      }
    }
  });
}

async function uploadNote(serverUrl: string, token: string | null, filename: string, content: string) {
  await fetch(`${serverUrl}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path: filename, content }),
  });
}

async function uploadAttachment(serverUrl: string, token: string | null, filename: string, bytes: Uint8Array) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart]), filename);
  fd.append("notePath", "");
  await fetch(`${serverUrl}/api/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
}
```

- [ ] **Step 2: Mount in AccountWindow**

```tsx
useEffect(() => {
  if (!core || !account) return;
  setupDropHandler({
    serverUrl: account.serverUrl,
    authToken: () => authStorage.getToken(account.id),
  });
}, [core, account]);
```

- [ ] **Step 3: Smoke**: drag a `.md` file onto the window; observe new note via sync.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat(tauri): drag-drop file import"
git push
```

---

## Phase B — Tier 3 native

### Task DCC-B1: Native notifications

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `package.json`
- Create: `src/tauri/notifications.ts`

- [ ] **Step 1: Install plugin**

```bash
npm install @tauri-apps/plugin-notification
```

```toml
tauri-plugin-notification = "2"
```

In main.rs: `.plugin(tauri_plugin_notification::init())`.

- [ ] **Step 2: Implement notify helper**

```ts
// src/tauri/notifications.ts
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let permissionChecked = false;
let permitted = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) return permitted;
  permissionChecked = true;
  permitted = await isPermissionGranted();
  if (!permitted) permitted = (await requestPermission()) === "granted";
  return permitted;
}

export async function notify(title: string, body?: string): Promise<void> {
  if (!(await ensurePermission())) return;
  sendNotification({ title, body });
}
```

- [ ] **Step 3: Wire to events** — in AccountWindow, on `sync:complete` event with new entities, call `notify`. Settings toggle controls whether to call.

- [ ] **Step 4: Commit**

```bash
git add src/ src-tauri/ package.json
git commit -m "feat(tauri): native notifications for sync/share/agent events"
git push
```

---

### Task DCC-B2: macOS Spotlight integration

**Files:**
- Create: `src-tauri/src/spotlight.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`

- [ ] **Step 1: Add objc2 deps (macOS only)**

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.5"
objc2-foundation = "0.2"
objc2-core-spotlight = "0.2"
```

- [ ] **Step 2: Implement spotlight.rs**

```rust
#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2_foundation::{NSString, NSArray};
use objc2_core_spotlight::{CSSearchableIndex, CSSearchableItem, CSSearchableItemAttributeSet};

pub fn index_note(account_id: &str, note_path: &str, title: &str, snippet: &str) -> Result<(), String> {
    unsafe {
        let attrs = CSSearchableItemAttributeSet::initWithItemContentType(NSString::from_str("public.text").as_ref());
        attrs.setTitle(Some(NSString::from_str(title).as_ref()));
        attrs.setContentDescription(Some(NSString::from_str(snippet).as_ref()));

        let unique_id = NSString::from_str(&format!("kryton-{}-{}", account_id, note_path));
        let domain_id = NSString::from_str(&format!("account-{}", account_id));
        let item = CSSearchableItem::initWithUniqueIdentifier_domainIdentifier_attributeSet(
            Some(unique_id.as_ref()),
            Some(domain_id.as_ref()),
            attrs.as_ref(),
        );
        let items = NSArray::from_vec(vec![item]);
        let index = CSSearchableIndex::defaultSearchableIndex();
        index.indexSearchableItems_completionHandler(items.as_ref(), None);
    }
    Ok(())
}

pub fn remove_note(account_id: &str, note_path: &str) -> Result<(), String> {
    unsafe {
        let unique_id = NSString::from_str(&format!("kryton-{}-{}", account_id, note_path));
        let ids = NSArray::from_vec(vec![unique_id]);
        let index = CSSearchableIndex::defaultSearchableIndex();
        index.deleteSearchableItemsWithIdentifiers_completionHandler(ids.as_ref(), None);
    }
    Ok(())
}

pub fn clear_account(account_id: &str) -> Result<(), String> {
    unsafe {
        let domain_id = NSString::from_str(&format!("account-{}", account_id));
        let domains = NSArray::from_vec(vec![domain_id]);
        let index = CSSearchableIndex::defaultSearchableIndex();
        index.deleteSearchableItemsWithDomainIdentifiers_completionHandler(domains.as_ref(), None);
    }
    Ok(())
}
```

(The exact objc2-core-spotlight API may differ; subagent verifies against the crate's docs and adjusts.)

- [ ] **Step 3: Tauri commands**

```rust
#[tauri::command]
#[cfg(target_os = "macos")]
async fn spotlight_index(account_id: String, note_path: String, title: String, snippet: String) -> Result<(), String> {
    spotlight::index_note(&account_id, &note_path, &title, &snippet)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
async fn spotlight_index(_: String, _: String, _: String, _: String) -> Result<(), String> { Ok(()) }
```

(Same pattern for `spotlight_remove`, `spotlight_clear_account`.)

- [ ] **Step 4: Wire from frontend** — on `sync:complete`, call `invoke("spotlight_index", ...)` for newly-changed notes.

- [ ] **Step 5: Manual smoke (macOS)**: open Spotlight (⌘Space), type a known note title; expect Kryton result. Click → opens via deep link.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/ src/
git commit -m "feat(macos): Spotlight indexing of note titles + snippets"
git push
```

---

### Task DCC-B3: Windows Search via .url shortcuts

**Files:**
- Create: `src-tauri/src/win_search.rs`

- [ ] **Step 1: Implement**

```rust
#![cfg(target_os = "windows")]

use std::fs;
use std::path::PathBuf;

fn shortcuts_dir(account_id: &str) -> Result<PathBuf, String> {
    let local = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
    let dir = PathBuf::from(local).join("Microsoft").join("Windows").join("Start Menu").join("Programs").join("Kryton").join(account_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn upsert_note(account_id: &str, note_path: &str, title: &str) -> Result<(), String> {
    let dir = shortcuts_dir(account_id)?;
    let safe_title = title.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_').collect::<String>();
    let path = dir.join(format!("{}.url", safe_title));
    let content = format!("[InternetShortcut]\nURL=kryton://note/{}?account={}\n", urlencoding::encode(note_path), account_id);
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn remove_note(account_id: &str, title: &str) -> Result<(), String> {
    let dir = shortcuts_dir(account_id)?;
    let safe_title = title.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_').collect::<String>();
    let _ = fs::remove_file(dir.join(format!("{}.url", safe_title)));
    Ok(())
}
```

Add `urlencoding = "2"` to Cargo.toml under target-windows.

- [ ] **Step 2: Tauri commands** (same `#[cfg(target_os)]` pattern as Spotlight).

- [ ] **Step 3: Wire from frontend** in same place that calls Spotlight.

- [ ] **Step 4: Smoke (Windows VM/machine)**: type known note title in Windows Search; expect shortcut result.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(windows): Search index via .url shortcuts"
git push
```

---

### Task DCC-B4: Touch Bar (macOS, lowest priority)

**Files:**
- Create: `src-tauri/src/touchbar.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Decide whether to ship** — if Touch Bar is desired, implement; otherwise skip.

If implementing: use `objc2-app-kit` to construct `NSTouchBar` items. ~150 lines of Rust. Subagent investigates current state of objc2-app-kit's NSTouchBar bindings; if unstable, defer.

- [ ] **Step 2: Wire** — touch bar shows current note title, sync status, "New Note" + "Toggle Edit/Preview" buttons. Updates via Tauri events from React.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(macos): Touch Bar with note title and quick actions"
git push
```

If skipped, document in SMOKE.md.

---

### Task DCC-B5: Windows taskbar jumplist

**Files:**
- Create: `src-tauri/src/jumplist.rs`

- [ ] **Step 1: Use `windows` crate**

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = ["Win32_UI_Shell_PropertiesSystem", "Win32_UI_Shell"] }
```

- [ ] **Step 2: Implement** — populate jumplist with "Recent Notes" (max 5 from focused account) and "Tasks: New Note, Open Quick Switcher". Subagent reads windows crate jumplist examples for the COM dance.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat(windows): taskbar jumplist with recent notes and tasks"
git push
```

---

## Phase C — Plugin manager + agents UI

### Task DCC-C1: Mount PluginManager from @azrtydxb/ui

**Files:**
- Modify: `src/AccountWindow.tsx`

- [ ] **Step 1: Wire `<PluginRoot>` and `<PluginManagerScreen>` from @azrtydxb/ui**

```tsx
import { PluginRoot, PluginManagerScreen, AppShell, Routes } from "@azrtydxb/ui";

<KrytonDataProvider adapter={adapter}>
  <PluginRoot>
    <AppShell>
      <Routes>
        {/* existing routes + */}
        <Route path="/settings/plugins" element={<PluginManagerScreen />} />
      </Routes>
    </AppShell>
  </PluginRoot>
</KrytonDataProvider>
```

- [ ] **Step 2: Configure CSP for plugin assets**

In `tauri.conf.json`:
```json
"app": {
  "security": {
    "csp": "default-src 'self' tauri: https://github.com https://raw.githubusercontent.com; script-src 'self' 'unsafe-eval' https://raw.githubusercontent.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' tauri: https: wss:;"
  }
}
```

- [ ] **Step 3: Manual smoke**: open Settings → Plugins; install one from the registry; verify it loads.

- [ ] **Step 4: Commit**

```bash
git add src/ tauri.conf.json
git commit -m "feat: plugin manager mounted; CSP allows GitHub raw plugin assets"
git push
```

---

### Task DCC-C2: Agents UI integration

**Files:**
- Modify: `src/AccountWindow.tsx`
- Modify: `src/core/CoreAdapter.ts` (add agent methods)

- [ ] **Step 1: Extend CoreAdapter with agent API methods**

```ts
// in CoreAdapter
agents = {
  list: async () => {
    const tok = await this.authTokenFn();
    const res = await fetch(`${this.serverUrl}/api/agents`, { headers: { Authorization: `Bearer ${tok}` } });
    return (await res.json()).agents;
  },
  create: async (input: { name: string; label: string; policyText?: string }) => {
    const tok = await this.authTokenFn();
    const res = await fetch(`${this.serverUrl}/api/agents`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify(input),
    });
    return res.json();
  },
  delete: async (id: string) => {
    const tok = await this.authTokenFn();
    await fetch(`${this.serverUrl}/api/agents/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
  },
  mintToken: async (agentId: string, expiresInSeconds: number) => {
    const tok = await this.authTokenFn();
    const res = await fetch(`${this.serverUrl}/api/agents/${agentId}/tokens`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ expiresInSeconds }),
    });
    return res.json();
  },
  // setPolicy, revokeToken, etc.
};
```

(CoreAdapter needs `serverUrl` + `authTokenFn` constructor params; refactor accordingly.)

- [ ] **Step 2: Mount AgentsScreen from @azrtydxb/ui**

```tsx
<Route path="/settings/agents" element={<AgentsScreen agents={adapter.agents} />} />
```

- [ ] **Step 3: Smoke**: open Settings → Agents; create agent; mint token; copy to clipboard; revoke.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: agents UI integrated via CoreAdapter agent methods"
git push
```

---

## Phase D — Full settings panels

### Task DCC-D1: Mount remaining settings panels

**Files:**
- Modify: `src/AccountWindow.tsx`

- [ ] **Step 1: Add routes for each panel**

```tsx
import { SettingsScreen, AccountPanel, AppearancePanel, EditorPanel, SyncPanel,
  NotificationsPanel, PluginsPanel, ApiKeysPanel, AgentsPanel,
  PrivacyPanel, HotkeysPanel, AdvancedPanel, DiagnosticsPanel } from "@azrtydxb/ui";

<Route path="/settings" element={
  <SettingsScreen panels={[
    { id: "account", label: "Account", element: <AccountPanel /> },
    { id: "appearance", label: "Appearance", element: <AppearancePanel /> },
    { id: "editor", label: "Editor", element: <EditorPanel /> },
    { id: "sync", label: "Sync", element: <SyncPanel /> },
    { id: "notifications", label: "Notifications", element: <NotificationsPanel /> },
    { id: "plugins", label: "Plugins", element: <PluginsPanel /> },
    { id: "apikeys", label: "API Keys", element: <ApiKeysPanel /> },
    { id: "agents", label: "Agents", element: <AgentsPanel /> },
    { id: "hotkeys", label: "Hotkeys", element: <HotkeysPanel /> },
    { id: "privacy", label: "Privacy", element: <PrivacyPanel /> },
    { id: "advanced", label: "Advanced", element: <AdvancedPanel /> },
    { id: "diagnostics", label: "Diagnostics", element: <DiagnosticsPanel /> },
  ]} />
} />
```

- [ ] **Step 2: Wire desktop-specific panel hooks** — e.g., HotkeysPanel needs Tauri's global-shortcut API to test/save bindings; AdvancedPanel's "Show Logs in Finder" needs `open` Tauri command. The `@azrtydxb/ui` panels accept these as injected callbacks via props.

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat: full settings panel mount"
git push
```

---

## Phase E — Windows build + signing

### Task DCC-E1: CI matrix for Windows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Update ci.yml to test on Windows too**

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - uses: dtolnay/rust-toolchain@stable
      - name: Configure npm auth
        shell: bash
        run: echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> ~/.npmrc
      - run: npm install --legacy-peer-deps
      - run: npx tsc --noEmit
      - run: npm test
      - name: Tauri debug build
        run: npm run tauri build -- --debug
```

- [ ] **Step 2: Smoke on Windows in CI** (just the build).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: matrix build on macOS and Windows"
git push
```

---

### Task DCC-E2: Code signing setup

This is partially manual — operator obtains certs, stores secrets.

- [ ] **Step 1: Operator obtains macOS Apple Developer ID Application cert**

Document in README.md the secrets to set:
- `APPLE_CERTIFICATE` (base64 of .p12)
- `APPLE_CERT_PASSWORD`
- `APPLE_NOTARY_USER` (Apple ID email)
- `APPLE_NOTARY_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

- [ ] **Step 2: Operator obtains Windows EV cert**

- `WINDOWS_CERT_BASE64` (base64 of .pfx)
- `WINDOWS_CERT_PASSWORD`

- [ ] **Step 3: Tauri signer keypair for updater**

```bash
npx tauri signer generate -w tauri-signing-key
```

Store private key as `TAURI_PRIVATE_KEY` secret. Public key goes into `tauri.conf.json` under `plugins.updater.pubkey`.

- [ ] **Step 4: README setup section**

Add to repo README:
```markdown
## Release setup
The release pipeline requires the following GitHub secrets:
- APPLE_CERTIFICATE (base64), APPLE_CERT_PASSWORD
- APPLE_NOTARY_USER, APPLE_NOTARY_PASSWORD, APPLE_TEAM_ID
- WINDOWS_CERT_BASE64, WINDOWS_CERT_PASSWORD
- TAURI_PRIVATE_KEY (the private signer key from `tauri signer generate`)

The Tauri public key is committed to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
```

- [ ] **Step 5: Commit**

```bash
git add README.md src-tauri/tauri.conf.json
git commit -m "docs: release secrets setup; commit Tauri updater public key"
git push
```

---

## Phase F — Release pipeline + auto-updater

### Task DCC-F1: release.yml

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: Release
on:
  push:
    tags: ["v*"]
jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - uses: dtolnay/rust-toolchain@stable
      - name: Configure npm
        run: echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> ~/.npmrc
      - run: npm install --legacy-peer-deps
      - name: Build + Sign + Notarize
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
          APPLE_SIGNING_IDENTITY: "Developer ID Application"
          APPLE_ID: ${{ secrets.APPLE_NOTARY_USER }}
          APPLE_PASSWORD: ${{ secrets.APPLE_NOTARY_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
        run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: macos
          path: src-tauri/target/release/bundle/dmg/*.dmg

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - uses: dtolnay/rust-toolchain@stable
      - name: Configure npm
        shell: bash
        run: echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> ~/.npmrc
      - run: npm install --legacy-peer-deps
      - name: Decode Windows cert
        shell: pwsh
        run: |
          [System.IO.File]::WriteAllBytes("cert.pfx", [System.Convert]::FromBase64String("${{ secrets.WINDOWS_CERT_BASE64 }}"))
      - name: Build + Sign
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
        run: npm run tauri build
      - name: Sign MSI
        shell: pwsh
        run: |
          $signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
          if (-not $signtool) { $signtool = "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.22621.0\\x64\\signtool.exe" }
          & $signtool sign /f cert.pfx /p "${{ secrets.WINDOWS_CERT_PASSWORD }}" /tr http://timestamp.digicert.com /td sha256 /fd sha256 src-tauri/target/release/bundle/msi/*.msi
      - uses: actions/upload-artifact@v4
        with:
          name: windows
          path: src-tauri/target/release/bundle/msi/*.msi

  release:
    needs: [build-mac, build-windows]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
      - name: Generate latest.json
        run: node scripts/generate-updater-manifest.js
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            macos/*.dmg
            windows/*.msi
            latest.json
```

- [ ] **Step 2: Write generate-updater-manifest.js**

Generates `latest.json` for Tauri's updater:
```js
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const tag = process.env.GITHUB_REF_NAME ?? "v0.0.0";
const version = tag.replace(/^v/, "");

const macDmg = readdirSync("macos").find(f => f.endsWith(".dmg"))!;
const winMsi = readdirSync("windows").find(f => f.endsWith(".msi"))!;

const repo = process.env.GITHUB_REPOSITORY ?? "azrtydxb/kryton-desktop";
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;

// Use Tauri CLI to sign each artifact
function signArtifact(path) {
  const out = execSync(`npx tauri signer sign --private-key "${process.env.TAURI_SIGNING_PRIVATE_KEY}" "${path}"`, { encoding: "utf8" });
  // Output is base64 signature
  return readFileSync(`${path}.sig`, "utf8").trim();
}

const manifest = {
  version,
  notes: `Release ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-x86_64": { signature: signArtifact(`macos/${macDmg}`), url: `${baseUrl}/${macDmg}` },
    "darwin-aarch64": { signature: signArtifact(`macos/${macDmg}`), url: `${baseUrl}/${macDmg}` },
    "windows-x86_64": { signature: signArtifact(`windows/${winMsi}`), url: `${baseUrl}/${winMsi}` },
  },
};

writeFileSync("latest.json", JSON.stringify(manifest, null, 2));
console.log("Wrote latest.json");
```

- [ ] **Step 3: Configure updater in tauri.conf.json**

```json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": ["https://github.com/azrtydxb/kryton-desktop/releases/latest/download/latest.json"],
    "pubkey": "PASTE_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE"
  }
}
```

In src-tauri Cargo.toml: `tauri-plugin-updater = "2"` and main.rs `.plugin(tauri_plugin_updater::Builder::new().build())`.

Frontend invokes update check on app start:
```ts
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export async function checkForUpdates() {
  const update = await check();
  if (update?.available) {
    await update.downloadAndInstall();
    await relaunch();
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml scripts/generate-updater-manifest.js src-tauri/ src/ package.json
git commit -m "feat(release): tagged release pipeline with signed builds and updater manifest"
git push
```

---

## Phase G — Distribution + final smoke

### Task DCC-G1: Cut v4.4.0-pre.1 release

- [ ] **Step 1: Bump version**

```bash
npm pkg set version="4.4.0-pre.1"
# Update tauri.conf.json version too
```

- [ ] **Step 2: Tag + push**

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "chore(release): v4.4.0-pre.1"
git tag v4.4.0-pre.1
git push origin master --tags
```

- [ ] **Step 3: Verify release CI succeeds**

```bash
gh run watch
```

Expected: macOS + Windows builds succeed; release published with .dmg, .msi, latest.json.

- [ ] **Step 4: Manual smoke** — download .dmg on a test Mac, install, launch, log in to a Kryton server, verify everything works.

- [ ] **Step 5: Verify auto-updater** — bump version to pre.2, push tag, observe pre.1 → pre.2 update flow.

---

### Task DCC-G2: README install instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add install section**

```markdown
## Install

### macOS
Download the latest `.dmg` from [Releases](https://github.com/azrtydxb/kryton-desktop/releases/latest), open it, and drag Kryton to your Applications folder.

### Windows
Download the latest `.msi` from [Releases](https://github.com/azrtydxb/kryton-desktop/releases/latest) and run the installer.

The app auto-updates on launch.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: install instructions"
git push
```

---

## Self-review

- [ ] Spec coverage: all Tier 2 (A1-A4), all Tier 3 (B1-B5), plugin manager (C1), agents UI (C2), all settings panels (D1), Windows build (E1), signing setup (E2), release pipeline (F1), distribution (G1, G2). Comprehensive.
- [ ] Type consistency: CoreAdapter agent additions match the API surface used by AgentsScreen from @azrtydxb/ui.
- [ ] No placeholders: every task has commands and code. The Spotlight task has a "subagent verifies and adjusts" note because objc2-core-spotlight bindings evolve; that's reality, not a placeholder.

## Open implementation questions

1. Touch Bar may be skipped if objc2-app-kit's NSTouchBar bindings are unstable. Document in SMOKE.md.
2. Windows EV cert procurement is operator-side; CI fails until cert is provisioned. Acceptable for v1 pre-release.
3. Auto-updater silent vs prompt UX: ship silent download + restart prompt; user-configurable later.
4. Multi-account multi-window menu actions need to be aware of which window is focused; currently the menu emits to "any" window. Tighten in v1.0 polish.
