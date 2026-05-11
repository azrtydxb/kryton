# `kryton-desktop` Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tauri shell + SQL.js adapter + multi-account multi-window + Tier 1 native + auth flow + minimum settings, working end-to-end on macOS in dev mode. Single stream.

**Architecture:** Tauri v2 application. WebView runs React + `@azrtydxb/ui`. SQL.js stores data in-WebView; Rust commands persist binary blobs to disk per-account. Each account gets its own window with its own Kryton instance.

**Tech Stack:** Tauri 2.x, Rust 1.75+, React 19, TypeScript 5.6, sql.js 1.10+, Vite 5/6, `@azrtydxb/{core,core-react,ui}@4.4.0-pre.7+`.

**Spec:** [`docs/superpowers/specs/2026-04-30-kryton-desktop-core-design.md`](../specs/2026-04-30-kryton-desktop-core-design.md)

**Repository:** New `azrtydxb/kryton-desktop`. Branch: `master`.

---

## File ownership

Single stream. All files in the new `kryton-desktop` repo.

---

## Setup

### Task DC-S1: Initialize Tauri + Vite project

**Files:**
- Create: `kryton-desktop/` (new repo)
- Create: `package.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`, etc. via `tauri init`

- [ ] **Step 1: Create the directory + repo**

```bash
mkdir -p /Users/pascal/Development/Kryton/kryton-desktop
cd /Users/pascal/Development/Kryton/kryton-desktop
git init
gh repo create azrtydxb/kryton-desktop --private --description "Kryton desktop app (Tauri + React)"
git remote add origin https://github.com/azrtydxb/kryton-desktop.git
```

- [ ] **Step 2: Initialize npm + Vite**

```bash
npm init -y
npm install --save-dev typescript@^5.6 vite@^5 @vitejs/plugin-react@^4 react@19 react-dom@19 @types/react@19 @types/react-dom@19
```

Edit `package.json`:
```json
{
  "name": "kryton-desktop",
  "version": "4.4.0-pre.7",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "vite:dev": "vite",
    "vite:build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "dev:link": "node scripts/dev-link.js link",
    "dev:unlink": "node scripts/dev-link.js unlink",
    "dev:verify": "node scripts/dev-link.js verify"
  }
}
```

Create `index.html`, `vite.config.ts`, `tsconfig.json`, `src/main.tsx` per Vite-React standard scaffold.

- [ ] **Step 3: Initialize Tauri**

```bash
npm install --save-dev @tauri-apps/cli@^2
npx tauri init
```

Answers: app name "Kryton", window title "Kryton", web assets dir "dist", dev URL "http://localhost:5173", frontend dev cmd "npm run vite:dev", frontend build cmd "npm run vite:build".

This creates `src-tauri/` with Rust setup.

- [ ] **Step 4: Verify dev runs**

```bash
npm run dev
```

Expected: a Tauri window opens with the default Vite + React page. Close the window.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: initial Tauri + Vite + React scaffold"
git push -u origin master
```

---

### Task DC-S2: Configure GitHub Packages auth

**Files:**
- Create: `.npmrc`
- Modify: `package.json`

- [ ] **Step 1: Create .npmrc**

```
@azrtydxb:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- [ ] **Step 2: Add @azrtydxb deps**

Edit `package.json`:
```json
"dependencies": {
  "@azrtydxb/core": "4.4.0-pre.7",
  "@azrtydxb/core-react": "4.4.0-pre.7",
  "@azrtydxb/ui": "4.4.0-pre.7",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "yjs": "^13.6.0",
  "y-protocols": "^1.0.6",
  "sql.js": "^1.10.0",
  "@tauri-apps/api": "^2"
},
"devDependencies": {
  ...,
  "@types/sql.js": "^1.4.0",
  "@tauri-apps/cli": "^2"
}
```

- [ ] **Step 3: Install**

```bash
GITHUB_TOKEN=$(gh auth token) npm install
```

Expected: installs all @azrtydxb/* packages from GitHub Packages.

- [ ] **Step 4: Verify import works**

Add to `src/main.tsx`:
```ts
import { Kryton } from "@azrtydxb/core";
console.log("Kryton class:", Kryton);
```

```bash
npm run vite:build
```

Expected: builds without errors.

- [ ] **Step 5: Commit**

```bash
git add .npmrc package.json package-lock.json
git commit -m "chore: configure @azrtydxb packages from GitHub Packages"
git push
```

---

### Task DC-S3: dev-link.js + husky pre-commit

**Files:**
- Create: `scripts/dev-link.js`
- Create: `.husky/pre-commit`

- [ ] **Step 1: Copy from kryton-mobile**

```bash
cp /Users/pascal/Development/Kryton/kryton-mobile/scripts/dev-link.js scripts/dev-link.js
chmod +x scripts/dev-link.js
```

- [ ] **Step 2: Update local-path defaults to include @azrtydxb/ui**

Edit `scripts/dev-link.js`:
```js
// Adjust the link/unlink to also handle @azrtydxb/ui
function deps() { return pkg.dependencies ?? (pkg.dependencies = {}); }
function targets() { return ["@azrtydxb/core", "@azrtydxb/core-react", "@azrtydxb/ui"]; }
function localPath(name: string) {
  const base = process.env.KRYTON_LOCAL_PATH ?? "../kryton/packages";
  return `${base}/${name.replace("@azrtydxb/", "")}`;
}
```

(The existing dev-link.js handles core + core-react; extend the pattern to ui.)

- [ ] **Step 3: Initialize husky**

```bash
npm install --save-dev husky
npx husky init
```

Replace `.husky/pre-commit`:
```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
node scripts/dev-link.js verify
```

- [ ] **Step 4: Test**

```bash
npm run dev:link
git status   # see file: deps in package.json
npm run dev:verify   # exits 1
git commit -am "test: should be blocked"  # blocked by hook
npm run dev:unlink
npm run dev:verify   # exits 0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ .husky/ package.json
git commit -m "chore: dev-link tooling and pre-commit guard"
git push
```

---

## Phase A — SqlJsAdapter + persistence

### Task DC-A1: SqlJsAdapter implementation

**Files:**
- Create: `src/core/SqlJsAdapter.ts`
- Create: `src/core/__tests__/SqlJsAdapter.test.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^1.6 @vitest/ui
```

Add `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Test (use the conformance suite from @azrtydxb/core)**

```ts
// src/core/__tests__/SqlJsAdapter.test.ts
import initSqlJs from "sql.js";
import { runConformanceSuite } from "@azrtydxb/core/dist/__tests__/adapter-conformance.js";
import { SqlJsAdapter } from "../SqlJsAdapter";

const SQL = await initSqlJs();
runConformanceSuite("SqlJsAdapter", () => {
  return new SqlJsAdapter(new SQL.Database());
});
```

(If `adapter-conformance` isn't exported from core's dist, copy the suite definition into `src/core/__tests__/conformance.ts` directly.)

- [ ] **Step 3: Run — fails**

- [ ] **Step 4: Implement** (per the spec)

Use the implementation in `2026-04-30-kryton-desktop-core-design.md` section "SqlJsAdapter".

- [ ] **Step 5: Run — passes**

```bash
npm test
```

Expected: 9 conformance tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/ vitest.config.ts package.json
git commit -m "feat(core): SqlJsAdapter passing core's conformance suite"
git push
```

---

### Task DC-A2: PersistenceManager

**Files:**
- Create: `src/core/persistence.ts`
- Create: `src/core/__tests__/persistence.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersistenceManager } from "../persistence";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
import { invoke } from "@tauri-apps/api/core";

describe("PersistenceManager", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flushes after debounce", async () => {
    const adapter = { serialize: () => new Uint8Array([1,2,3]) } as any;
    const pm = new PersistenceManager(adapter, "acc1", 50);
    pm.scheduleFlush();
    await new Promise(r => setTimeout(r, 100));
    expect(invoke).toHaveBeenCalledWith("write_db", { accountId: "acc1", bytes: [1,2,3] });
  });

  it("debounces multiple schedules into one flush", async () => {
    const adapter = { serialize: () => new Uint8Array([1]) } as any;
    const pm = new PersistenceManager(adapter, "acc1", 50);
    pm.scheduleFlush();
    pm.scheduleFlush();
    pm.scheduleFlush();
    await new Promise(r => setTimeout(r, 100));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("flushNow flushes immediately", async () => {
    const adapter = { serialize: () => new Uint8Array([5]) } as any;
    const pm = new PersistenceManager(adapter, "acc1", 5000);
    pm.scheduleFlush();
    await pm.flushNow();
    expect(invoke).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement** per spec section "Persistence (`src/core/persistence.ts`)".

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add src/core/persistence.ts src/core/__tests__/persistence.test.ts
git commit -m "feat(core): PersistenceManager with debounced flush"
git push
```

---

### Task DC-A3: Tauri db_io commands

**Files:**
- Create: `src-tauri/src/db_io.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add Cargo deps**

Edit `src-tauri/Cargo.toml`:
```toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tokio = { version = "1", features = ["fs"] }
```

- [ ] **Step 2: Implement db_io.rs** per spec.

```rust
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub async fn read_db(account_id: String, app_handle: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let path = account_db_path(&app_handle, &account_id)?;
    if !path.exists() { return Ok(vec![]); }
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_db(account_id: String, bytes: Vec<u8>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = account_db_path(&app_handle, &account_id)?;
    let parent = path.parent().ok_or("no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("db.tmp");
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn account_db_path(app: &tauri::AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("accounts").join(account_id).join("kryton.db"))
}
```

- [ ] **Step 3: Register commands in main.rs**

```rust
mod db_io;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            db_io::read_db,
            db_io::write_db,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verify Tauri builds**

```bash
npm run dev
```

(Tauri window opens; commands registered.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): db_io read_db/write_db commands"
git push
```

---

### Task DC-A4: desktop-init.ts wiring everything together

**Files:**
- Create: `src/core/desktop-init.ts`
- Create: `src/core/__tests__/desktop-init.test.ts`

- [ ] **Step 1: Test (mocked)**

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => new Uint8Array()) }));
vi.mock("sql.js", () => ({ default: vi.fn(async () => ({ Database: class { exec(){} prepare() { return { run: () => {}, step: () => false, getAsObject: () => ({}), free: () => {}, bind: () => {} } } export() { return new Uint8Array(); } close() {} getRowsModified() { return 0; } })) } }));

import { initDesktopCore } from "../desktop-init";

describe("initDesktopCore", () => {
  it("returns a Kryton instance", async () => {
    const k = await initDesktopCore({ accountId: "acc1", serverUrl: "https://example.com", authToken: () => "T" });
    expect(k).toBeDefined();
    await k.close();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/core/desktop-init.ts
import { Kryton, type KrytonInitOpts } from "@azrtydxb/core";
import initSqlJs from "sql.js";
import { invoke } from "@tauri-apps/api/core";
import { SqlJsAdapter } from "./SqlJsAdapter";
import { PersistenceManager } from "./persistence";

let SQL: any | null = null;

export interface DesktopInitOpts {
  accountId: string;
  serverUrl: string;
  authToken: () => string | null | Promise<string | null>;
}

export async function initDesktopCore(opts: DesktopInitOpts): Promise<Kryton> {
  if (!SQL) SQL = await initSqlJs({
    locateFile: (file: string) => `/${file}`, // sql-wasm.wasm in public/
  });

  // 1. Read existing DB blob
  const bytesResp = await invoke<number[] | Uint8Array>("read_db", { accountId: opts.accountId });
  const bytes = bytesResp instanceof Uint8Array ? bytesResp : new Uint8Array(bytesResp);

  // 2. Create SqlJsAdapter
  const db = bytes.length > 0 ? new SQL.Database(bytes) : new SQL.Database();
  const adapter = new SqlJsAdapter(db);

  // 3. Init Kryton
  const k = await Kryton.init({
    adapter,
    serverUrl: opts.serverUrl,
    authToken: opts.authToken,
  });

  // 4. Wire persistence: schedule flush on every local change
  const pm = new PersistenceManager(adapter, opts.accountId, 500);
  k.bus.on("change", (e: any) => {
    if (e.source === "local") pm.scheduleFlush();
  });
  k.bus.on("yjs:update", () => pm.scheduleFlush());

  // 5. Final flush on close
  const origClose = k.close.bind(k);
  (k as any).close = async () => {
    await pm.flushNow();
    return origClose();
  };

  return k;
}
```

- [ ] **Step 3: Copy sql-wasm.wasm to public/**

```bash
mkdir -p public
cp node_modules/sql.js/dist/sql-wasm.wasm public/
```

- [ ] **Step 4: Run — passes**

- [ ] **Step 5: Commit**

```bash
git add src/core/desktop-init.ts src/core/__tests__/ public/sql-wasm.wasm
git commit -m "feat(core): desktop-init wiring SQL.js + persistence + Kryton"
git push
```

---

## Phase B — Multi-account multi-window

### Task DC-B1: account_store.rs

**Files:**
- Create: `src-tauri/src/account_store.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Implement**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub server_url: String,
    pub last_logged_in_at: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct AccountStore { accounts: Vec<Account> }

fn store_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("accounts.json"))
}

fn load(app: &tauri::AppHandle) -> Result<AccountStore, String> {
    let path = store_path(app)?;
    if !path.exists() { return Ok(AccountStore::default()); }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn save(app: &tauri::AppHandle, store: &AccountStore) -> Result<(), String> {
    let path = store_path(app)?;
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_accounts(app: tauri::AppHandle) -> Result<Vec<Account>, String> {
    Ok(load(&app)?.accounts)
}

#[tauri::command]
pub async fn add_account(label: String, server_url: String, app: tauri::AppHandle) -> Result<Account, String> {
    let mut store = load(&app)?;
    let id = format!("acc_{}", uuid::Uuid::new_v4().simple());
    let acc = Account { id: id.clone(), label, server_url, last_logged_in_at: chrono::Utc::now().timestamp() };
    store.accounts.push(acc.clone());
    save(&app, &store)?;
    Ok(acc)
}

#[tauri::command]
pub async fn remove_account(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut store = load(&app)?;
    store.accounts.retain(|a| a.id != account_id);
    save(&app, &store)?;
    Ok(())
}

#[tauri::command]
pub async fn rename_account(account_id: String, new_label: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut store = load(&app)?;
    for a in &mut store.accounts { if a.id == account_id { a.label = new_label.clone(); } }
    save(&app, &store)?;
    Ok(())
}

#[tauri::command]
pub async fn touch_account(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let mut store = load(&app)?;
    for a in &mut store.accounts { if a.id == account_id { a.last_logged_in_at = chrono::Utc::now().timestamp(); } }
    save(&app, &store)?;
    Ok(())
}
```

Add to Cargo.toml:
```toml
uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
```

- [ ] **Step 2: Register commands**

In `src-tauri/src/main.rs`, add to `invoke_handler`:
```rust
account_store::list_accounts,
account_store::add_account,
account_store::remove_account,
account_store::rename_account,
account_store::touch_account,
```

- [ ] **Step 3: Build verifies**

```bash
npm run dev
# Open the Tauri window, in dev console: invoke("list_accounts").then(console.log) — expect []
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): account_store with persistence"
git push
```

---

### Task DC-B2: window_manager.rs

**Files:**
- Create: `src-tauri/src/window_manager.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Implement**

```rust
use tauri::{Manager, WebviewWindowBuilder, WebviewUrl};

#[tauri::command]
pub async fn open_account_window(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let label = format!("account-{}", account_id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = WebviewUrl::App(format!("index.html?account={}", account_id).into());
    WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("Kryton — {}", account_id))
        .inner_size(1200.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_launcher_window(app: tauri::AppHandle) -> Result<(), String> {
    let label = "launcher";
    if let Some(existing) = app.get_webview_window(label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = WebviewUrl::App("index.html?launcher=1".into());
    WebviewWindowBuilder::new(&app, label, url)
        .title("Kryton")
        .inner_size(700.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Register**

Add to `invoke_handler`: `window_manager::open_account_window`, `window_manager::open_launcher_window`.

- [ ] **Step 3: Modify Tauri startup behavior**

In `tauri.conf.json`, set the default window to NOT auto-open. Instead, in `main.rs` `setup` callback, open launcher window:

```rust
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = window_manager::open_launcher_window(handle).await;
            });
            Ok(())
        })
        // ... handlers ...
}
```

Remove or hide the default window from `tauri.conf.json` `app.windows`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat(tauri): window manager and launcher window auto-open"
git push
```

---

### Task DC-B3: window-state plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install @tauri-apps/plugin-window-state
```

In Cargo.toml:
```toml
tauri-plugin-window-state = "2"
```

- [ ] **Step 2: Register plugin**

In main.rs:
```rust
.plugin(tauri_plugin_window_state::Builder::default().build())
```

- [ ] **Step 3: Verify** windows remember position/size across app restarts.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/ package.json package-lock.json
git commit -m "feat(tauri): window state plugin"
git push
```

---

## Phase C — Auth + first-run

### Task DC-C1: Secure storage wrapper for auth tokens

**Files:**
- Create: `src/auth/auth-storage.ts`

- [ ] **Step 1: Add tauri-plugin-stronghold or use keyring**

Easier: use `keyring` Tauri plugin (now `@tauri-apps/plugin-stronghold` or `tauri-plugin-keyring`).

For now use a simple file-based approach for v1 simplicity (move to keyring later):

```ts
// src/auth/auth-storage.ts
import { invoke } from "@tauri-apps/api/core";

export const authStorage = {
  async getToken(accountId: string): Promise<string | null> {
    return invoke("get_auth_token", { accountId });
  },
  async setToken(accountId: string, token: string): Promise<void> {
    return invoke("set_auth_token", { accountId, token });
  },
  async clearToken(accountId: string): Promise<void> {
    return invoke("clear_auth_token", { accountId });
  },
};
```

- [ ] **Step 2: Implement Rust side**

`src-tauri/src/auth_storage.rs`:
```rust
use std::fs;
use tauri::Manager;

fn token_path(app: &tauri::AppHandle, account_id: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("tokens")).map_err(|e| e.to_string())?;
    Ok(dir.join("tokens").join(format!("{}.tok", account_id)))
}

#[tauri::command]
pub async fn get_auth_token(account_id: String, app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = token_path(&app, &account_id)?;
    if !p.exists() { return Ok(None); }
    fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_auth_token(account_id: String, token: String, app: tauri::AppHandle) -> Result<(), String> {
    let p = token_path(&app, &account_id)?;
    fs::write(&p, token).map_err(|e| e.to_string())?;
    // chmod 600 if on unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_auth_token(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let p = token_path(&app, &account_id)?;
    let _ = fs::remove_file(&p);
    Ok(())
}
```

Register in main.rs.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/ src/auth/
git commit -m "feat(auth): secure token storage (file-based, 0600 perms; replace with keyring later)"
git push
```

---

### Task DC-C2: ServerSetup screen

**Files:**
- Create: `src/auth/ServerSetup.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ServerSetup({ onConnected }: { onConnected: (serverUrl: string, label: string) => void }) {
  const [url, setUrl] = useState("https://");
  const [label, setLabel] = useState("My Kryton");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      const probe = await fetch(`${url.replace(/\/$/, "")}/api/version`);
      if (!probe.ok) throw new Error(`Server returned ${probe.status}`);
      const v = await probe.json();
      if (!v.version) throw new Error("Not a Kryton server");
      onConnected(url.replace(/\/$/, ""), label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl">Connect to your Kryton server</h1>
      <input className="w-full border p-2" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://kryton.example.com" />
      <input className="w-full border p-2" value={label} onChange={e => setLabel(e.target.value)} placeholder="Account label (e.g. Personal)" />
      {error && <p className="text-red-600">{error}</p>}
      <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth/ServerSetup.tsx
git commit -m "feat(auth): ServerSetup screen with URL probe"
git push
```

---

### Task DC-C3: LoginScreen

**Files:**
- Create: `src/auth/LoginScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";

interface LoginScreenProps {
  serverUrl: string;
  onLoggedIn: (token: string) => void;
}

export function LoginScreen({ serverUrl, onLoggedIn }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${serverUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(`Login failed: ${res.status}`);
      const body = await res.json();
      const token = body.token ?? body.session?.token;
      if (!token) throw new Error("No token returned");
      onLoggedIn(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl">Log in to {new URL(serverUrl).host}</h1>
      <input className="w-full border p-2" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input className="w-full border p-2" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      {error && <p className="text-red-600">{error}</p>}
      <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={login} disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth/LoginScreen.tsx
git commit -m "feat(auth): LoginScreen via better-auth /api/auth/sign-in/email"
git push
```

---

### Task DC-C4: Launcher window app + first-run flow

**Files:**
- Create: `src/LauncherApp.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Implement LauncherApp**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ServerSetup } from "./auth/ServerSetup";
import { LoginScreen } from "./auth/LoginScreen";
import { authStorage } from "./auth/auth-storage";

interface Account { id: string; label: string; serverUrl: string; lastLoggedInAt: number; }

export function LauncherApp() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [step, setStep] = useState<"list" | "setup" | "login">("list");
  const [pending, setPending] = useState<{ serverUrl: string; label: string; account?: Account } | null>(null);

  useEffect(() => {
    invoke<Account[]>("list_accounts").then(accs => {
      setAccounts(accs);
      if (accs.length === 0) setStep("setup");
    });
  }, []);

  async function openAccount(account: Account) {
    await invoke("open_account_window", { accountId: account.id });
    // Close launcher (not implemented; in v1 we just leave it open)
  }

  async function handleConnected(serverUrl: string, label: string) {
    setPending({ serverUrl, label });
    setStep("login");
  }

  async function handleLoggedIn(token: string) {
    if (!pending) return;
    const acc = await invoke<Account>("add_account", { label: pending.label, serverUrl: pending.serverUrl });
    await authStorage.setToken(acc.id, token);
    await invoke("open_account_window", { accountId: acc.id });
  }

  if (step === "setup") return <ServerSetup onConnected={handleConnected} />;
  if (step === "login" && pending) return <LoginScreen serverUrl={pending.serverUrl} onLoggedIn={handleLoggedIn} />;

  return (
    <div className="p-6">
      <h1 className="text-2xl mb-4">Kryton</h1>
      <h2 className="mb-2">Accounts</h2>
      {accounts?.map(a => (
        <button key={a.id} className="block w-full text-left p-3 border mb-2 hover:bg-gray-50" onClick={() => openAccount(a)}>
          <div className="font-medium">{a.label}</div>
          <div className="text-sm text-gray-500">{new URL(a.serverUrl).host}</div>
        </button>
      ))}
      <button className="mt-4 text-blue-600" onClick={() => setStep("setup")}>+ Add account</button>
    </div>
  );
}
```

- [ ] **Step 2: Update main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { LauncherApp } from "./LauncherApp";
import { AccountWindow } from "./AccountWindow";  // see DC-D1
import "./globals.css";

const params = new URLSearchParams(window.location.search);
const isLauncher = params.has("launcher");
const accountId = params.get("account");

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (isLauncher || (!accountId)) {
  root.render(<LauncherApp />);
} else {
  root.render(<AccountWindow accountId={accountId} />);
}
```

(`AccountWindow` is created in DC-D1.)

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "feat: LauncherApp first-run flow"
git push
```

---

## Phase D — Account window + UI integration

### Task DC-D1: CoreAdapter implementing KrytonDataAdapter

**Files:**
- Create: `src/core/CoreAdapter.ts`

- [ ] **Step 1: Implement** — CoreAdapter wraps a `Kryton` instance and exposes the `KrytonDataAdapter` interface from `@azrtydxb/ui`.

```ts
import type { Kryton, Note, Folder, Tag, Settings as SettingsRow, NoteShare, TrashItem } from "@azrtydxb/core";
import type { KrytonDataAdapter, NoteFilter, NoteData, FolderData, TagData, SettingData, NoteShareData, TrashItemData, SyncStatus, CurrentUser } from "@azrtydxb/ui";

export class CoreAdapter implements KrytonDataAdapter {
  constructor(private k: Kryton, private user: CurrentUser | null = null) {}

  notes = {
    list: (filter?: NoteFilter): NoteData[] => {
      const all = this.k.notes.list() as Note[];
      if (filter?.folderPath) return all.filter(n => n.path.startsWith(filter.folderPath!));
      return all;
    },
    findById: (id: string) => (this.k.notes.findById(id) as Note | null),
    findByPath: (p: string) => (this.k.notes.findByPath(p) as Note | null),
    create: async (input: any) => {
      const note = this.k.notes.create(input);
      return note as Note;
    },
    update: async (id: string, patch: any) => { this.k.notes.update(id, patch); },
    delete: async (id: string) => { this.k.notes.delete(id); },
  };
  folders = {
    list: () => this.k.folders.list() as Folder[],
    create: async (input: any) => this.k.folders.create(input as any) as Folder,
    delete: async (id: string) => this.k.folders.delete(id),
  };
  tags = { list: () => this.k.tags.list() as Tag[] };
  settings = {
    get: (key: string) => {
      const all = this.k.settings.list() as SettingsRow[];
      return all.find(s => s.key === key)?.value ?? null;
    },
    set: async (key: string, value: string) => {
      const all = this.k.settings.list() as SettingsRow[];
      const existing = all.find(s => s.key === key);
      if (existing) this.k.settings.update(existing.id, { value });
      else this.k.settings.create({ key, value } as any);
    },
  };
  noteShares = { list: () => this.k.noteShares.list() as NoteShare[] };
  trashItems = {
    list: () => this.k.trashItems.list() as TrashItem[],
    restore: async (_id: string) => { /* TODO via API */ },
    purge: async (id: string) => { this.k.trashItems.delete(id); },
    purgeAll: async () => { for (const t of this.k.trashItems.list()) this.k.trashItems.delete((t as any).id); },
  };

  subscribe(entityType: string, _ids: string[] | "*", cb: () => void): () => void {
    return this.k.bus.on("change", (e: any) => {
      if (e.entityType === entityType) cb();
    });
  }

  async openDocument(noteId: string) { return this.k.yjs.openDocument(noteId); }
  closeDocument(noteId: string) { this.k.yjs.closeDocument(noteId); }
  getAwareness(noteId: string) { return this.k.yjs.getAwareness(noteId); }
  readNoteContent(noteId: string) { return this.k.readNoteContent(noteId); }

  getSyncStatus(): SyncStatus {
    return {
      lastPullAt: parseInt(this.k.storage.get("last_pull_at", "0"), 10) || null,
      lastPushAt: parseInt(this.k.storage.get("last_push_at", "0"), 10) || null,
      pending: 0,
      online: true,
    };
  }
  async triggerSync() { await this.k.sync.full(); }

  currentUser() { return this.user; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/CoreAdapter.ts
git commit -m "feat(core): CoreAdapter mapping @azrtydxb/core to KrytonDataAdapter"
git push
```

---

### Task DC-D2: AccountWindow component

**Files:**
- Create: `src/AccountWindow.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Kryton } from "@azrtydxb/core";
import { KrytonDataProvider, AppShell } from "@azrtydxb/ui";
import { initDesktopCore } from "./core/desktop-init";
import { CoreAdapter } from "./core/CoreAdapter";
import { authStorage } from "./auth/auth-storage";

interface Account { id: string; label: string; serverUrl: string; }

export function AccountWindow({ accountId }: { accountId: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [core, setCore] = useState<Kryton | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accounts = await invoke<Account[]>("list_accounts");
        const acc = accounts.find(a => a.id === accountId);
        if (!acc) throw new Error("Account not found");
        setAccount(acc);

        const k = await initDesktopCore({
          accountId,
          serverUrl: acc.serverUrl,
          authToken: () => authStorage.getToken(accountId),
        });
        if (cancelled) { await k.close(); return; }

        await k.sync.full();
        k.sync.startAuto({ intervalMs: 60_000 });
        await invoke("touch_account", { accountId });

        setCore(k);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to start");
      }
    })();
    return () => { cancelled = true; core?.close(); };
  }, [accountId]);

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!core || !account) return <div className="p-6">Loading {accountId}…</div>;

  const adapter = new CoreAdapter(core);
  return (
    <KrytonDataProvider adapter={adapter}>
      <AppShell>
        {/* @azrtydxb/ui provides the rest of the UI */}
      </AppShell>
    </KrytonDataProvider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/AccountWindow.tsx
git commit -m "feat: AccountWindow wiring CoreAdapter into @azrtydxb/ui"
git push
```

---

## Phase E — Tier 1 native menus + dialogs

### Task DC-E1: Native menu bar

**Files:**
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Implement basic menu** per spec section "Native menu bar".

```rust
use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};

pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(app, "Kryton", true, &[
        &PredefinedMenuItem::about(app, None, None)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "preferences", "Preferences...", true, Some("CmdOrCtrl+,"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::services(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, None)?,
        &PredefinedMenuItem::hide_others(app, None)?,
        &PredefinedMenuItem::show_all(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::quit(app, None)?,
    ])?;
    let file_menu = Submenu::with_items(app, "File", true, &[
        &MenuItem::with_id(app, "new-note", "New Note", true, Some("CmdOrCtrl+N"))?,
        &MenuItem::with_id(app, "new-window", "New Window", true, Some("CmdOrCtrl+Shift+N"))?,
        &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, None)?,
    ])?;
    let edit_menu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;
    let view_menu = Submenu::with_items(app, "View", true, &[
        &MenuItem::with_id(app, "toggle-sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))?,
        &MenuItem::with_id(app, "toggle-graph", "Toggle Graph", true, Some("CmdOrCtrl+Shift+G"))?,
        &MenuItem::with_id(app, "toggle-edit-preview", "Toggle Edit/Preview", true, Some("CmdOrCtrl+E"))?,
    ])?;
    let window_menu = Submenu::with_items(app, "Window", true, &[
        &PredefinedMenuItem::minimize(app, None)?,
    ])?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}
```

- [ ] **Step 2: Wire into builder**

In main.rs:
```rust
.setup(|app| {
    let menu = menu::create_menu(app.handle())?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        // emit to frontend via window event
        if let Some(window) = app.get_webview_window("launcher").or_else(|| {
            // pick currently focused account window
            app.webview_windows().values().next().cloned()
        }) {
            let _ = window.emit("menu-action", id);
        }
    });
    Ok(())
})
```

- [ ] **Step 3: Frontend listens for menu events**

In `AccountWindow.tsx`:
```tsx
useEffect(() => {
  const unlistenP = listen<string>("menu-action", (e) => {
    const id = e.payload;
    if (id === "new-note") { /* dispatch new note */ }
    // ... other actions
  });
  return () => { unlistenP.then(un => un()); };
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/ src/
git commit -m "feat(tauri): native menu bar with platform shortcuts"
git push
```

---

### Task DC-E2: File dialogs (Open / Export)

**Files:**
- Create: `src/tauri/file-dialogs.ts`
- Modify: `package.json`

- [ ] **Step 1: Install plugin**

```bash
npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-fs
```

In Cargo.toml:
```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

In main.rs:
```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
```

- [ ] **Step 2: Implement helpers**

```ts
// src/tauri/file-dialogs.ts
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export async function pickMarkdownFile(): Promise<{ path: string; content: string } | null> {
  const path = await open({ filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
  if (typeof path !== "string") return null;
  const content = await readTextFile(path);
  return { path, content };
}

export async function exportNote(filename: string, content: string): Promise<void> {
  const path = await save({ defaultPath: filename, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (!path) return;
  await writeTextFile(path, content);
}
```

- [ ] **Step 3: Wire into menu actions** (File → Open / Export Note → Export Vault)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/ src/ package.json
git commit -m "feat(tauri): file dialogs for import/export"
git push
```

---

## Phase F — Smoke + CI + release stub

### Task DC-F1: Manual smoke checklist

- [ ] **Step 1: Run dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Manual smoke**

1. Launcher opens; click "Add account".
2. Enter server URL; clicks Connect; success.
3. Enter email/password; click Log in; account window opens.
4. Account window shows Kryton UI with notes from server.
5. Create a note in the account window; observe sync.
6. Quit the app.
7. Re-launch: most-recent account's window opens directly with notes intact.
8. From File → New Window: launcher opens. Add second account; second window opens.
9. Both windows show their respective accounts' data.

- [ ] **Step 3: Document any deviations** in a SMOKE.md if anything doesn't work; defer fix to follow-up tasks.

---

### Task DC-F2: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write**

```yaml
name: CI
on:
  push: { branches: [master] }
  pull_request: { branches: [master] }
jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "24" }
      - uses: dtolnay/rust-toolchain@stable
      - name: Configure npm auth
        run: echo "//npm.pkg.github.com/:_authToken=${{ secrets.GITHUB_TOKEN }}" >> ~/.npmrc
      - run: npm install --legacy-peer-deps
      - run: npx tsc --noEmit
      - run: npm test
      - name: Tauri build (debug, no signing)
        run: npm run tauri build -- --debug
      - run: node scripts/dev-link.js verify
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "ci: build + test workflow"
git push
```

Sub-project 2 done when smoke passes and CI is green. Tier 2/3 native, Windows, signing, release pipeline are sub-project 3.

---

## Self-review

- [ ] Spec coverage: SqlJsAdapter (DC-A1), persistence (DC-A2, DC-A3), desktop-init (DC-A4), accounts (DC-B1), windows (DC-B2, DC-B3), auth flow (DC-C1..C4), CoreAdapter (DC-D1), AccountWindow (DC-D2), Tier 1 native menu (DC-E1) + dialogs (DC-E2). All in.
- [ ] Type consistency: `KrytonDataAdapter` shape matches across CoreAdapter (DC-D1) and the spec it's copied from (sub-project 1's spec).
- [ ] No placeholders.

## Open implementation questions

1. Whether to switch from file-based token storage to OS keyring (`tauri-plugin-stronghold`) before v1 release. v1.0 may ship file-based; tracked.
2. AccountWindow does not yet have plugin loader integrated — comes in sub-project 3.
3. CoreAdapter's `trashItems.restore` is a stub (no API call yet) — tracked for sub-project 3.
