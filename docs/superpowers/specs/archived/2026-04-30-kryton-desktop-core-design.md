# `kryton-desktop` Core — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 2 of 3 in the desktop app track.
**Depends on:** `@azrtydxb/ui` (sub-project 1) being published.
**Successor:** `2026-04-30-kryton-desktop-complete-design.md`.

## Purpose

Build the Tauri shell, SQL.js-backed data adapter, multi-account multi-window infrastructure, Tier 1 native integrations, auth flow, and basic settings. macOS-only initially; Windows in sub-project 3. The goal of this sub-project is *a desktop app that works end-to-end on a developer's Mac* — not a polished release.

## Repository

New: `azrtydxb/kryton-desktop` (sibling to `kryton`, `kryton-mobile`, `kryton-plugins`).

```
kryton-desktop/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                # entry, plugin registration, command exports
│       ├── account_store.rs       # accounts.json read/write, per-account paths
│       ├── window_manager.rs      # multi-account window create/focus
│       ├── db_io.rs               # read_db / write_db Tauri commands
│       ├── menu.rs                # native menu bar
│       └── window_state.rs        # window-state plugin wrapper
├── src/
│   ├── main.tsx                   # React entry; resolves accountId from window label
│   ├── App.tsx                    # mounts <KrytonDataProvider>(<CoreAdapter>) + ui shell
│   ├── core/
│   │   ├── SqlJsAdapter.ts
│   │   ├── persistence.ts         # debounced flush
│   │   ├── desktop-init.ts        # Kryton.init wiring SQL.js + persistence
│   │   └── CoreAdapter.ts         # KrytonDataAdapter impl wrapping Kryton instance
│   ├── auth/
│   │   ├── ServerSetup.tsx        # first-run server URL
│   │   ├── LoginScreen.tsx
│   │   └── auth-storage.ts        # Tauri secure store wrapper
│   ├── tauri/
│   │   ├── menu-bridge.ts
│   │   └── window-state.ts
│   └── routes.tsx                 # in-app history stack
├── public/
│   └── sql-wasm.wasm              # SQL.js WASM payload
├── package.json
├── .npmrc
└── scripts/dev-link.js
```

## SQL.js + persistence

### `SqlJsAdapter` (TypeScript, in `src/core/SqlJsAdapter.ts`)

Implements the `SqliteAdapter` contract from `@azrtydxb/core`. Sync API. Backed by an in-memory `sql.js` `Database` instance.

```ts
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type { SqliteAdapter, SqliteRunResult, Row } from "@azrtydxb/core";

export class SqlJsAdapter implements SqliteAdapter {
  private db: Database;
  constructor(db: Database) { this.db = db; }

  exec(sql: string): void { this.db.exec(sql); }

  run(sql: string, params: readonly unknown[]): SqliteRunResult {
    const stmt = this.db.prepare(sql);
    stmt.run(params as any[]);
    const changes = this.db.getRowsModified();
    stmt.free();
    return { changes, lastInsertRowid: this.db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] as number ?? 0 };
  }

  get<R = Row>(sql: string, params: readonly unknown[]): R | undefined {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as any[]);
    const result = stmt.step() ? stmt.getAsObject() as R : undefined;
    stmt.free();
    return result;
  }

  all<R = Row>(sql: string, params: readonly unknown[]): R[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as any[]);
    const rows: R[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as R);
    stmt.free();
    return rows;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close(): void { this.db.close(); }

  /** Internal: serialize for persistence flush. */
  serialize(): Uint8Array { return this.db.export(); }

  /** Internal: rehydrate from saved bytes. Returns a fresh adapter wrapping the loaded DB. */
  static async load(SQL: SqlJsStatic, bytes: Uint8Array | null): Promise<SqlJsAdapter> {
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    return new SqlJsAdapter(db);
  }
}
```

### Persistence (`src/core/persistence.ts`)

Debounced flush that calls a Tauri command to write the SQL.js bytes to disk atomically.

```ts
import { invoke } from "@tauri-apps/api/core";
import type { SqlJsAdapter } from "./SqlJsAdapter";

export class PersistenceManager {
  private adapter: SqlJsAdapter;
  private accountId: string;
  private flushTimer: number | null = null;
  private flushing = false;
  private pendingFlush = false;
  private debounceMs: number;

  constructor(adapter: SqlJsAdapter, accountId: string, debounceMs = 500) {
    this.adapter = adapter;
    this.accountId = accountId;
    this.debounceMs = debounceMs;
  }

  /** Call after every write. Schedules a debounced flush. */
  scheduleFlush(): void {
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs) as unknown as number;
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      this.pendingFlush = true;
      return;
    }
    this.flushing = true;
    this.flushTimer = null;
    try {
      const bytes = this.adapter.serialize();
      await invoke("write_db", { accountId: this.accountId, bytes: Array.from(bytes) });
    } finally {
      this.flushing = false;
      if (this.pendingFlush) {
        this.pendingFlush = false;
        this.scheduleFlush();
      }
    }
  }

  /** Synchronous-style flush at window close. Caller awaits. */
  async flushNow(): Promise<void> {
    if (this.flushTimer != null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    await this.flush();
  }
}
```

The Kryton instance is wrapped to call `persistence.scheduleFlush()` whenever the bus emits a `change` event with `source === 'local'` (the Phase 2 event bus protocol). That covers all writes through repositories and Yjs updates.

### Tauri side: `db_io.rs`

```rust
#[tauri::command]
async fn read_db(account_id: String, app_handle: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let path = account_db_path(&app_handle, &account_id)?;
    if !path.exists() { return Ok(vec![]); }
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_db(account_id: String, bytes: Vec<u8>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = account_db_path(&app_handle, &account_id)?;
    let tmp = path.with_extension("db.tmp");
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    // Best-effort fsync via File::sync_all
    if let Ok(f) = std::fs::File::open(&tmp) { let _ = f.sync_all(); }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn account_db_path(app: &tauri::AppHandle, account_id: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("accounts").join(account_id).join("kryton.db"))
}
```

`app_data_dir()` resolves to `~/Library/Application Support/com.azrtydxb.kryton/` on macOS.

## Multi-account multi-window

### Account store (Tauri: `src-tauri/src/account_store.rs`)

JSON file at `<app_data_dir>/accounts.json`:

```json
{
  "accounts": [
    { "id": "acc_abc123", "label": "Personal", "serverUrl": "https://my.kryton.example", "lastLoggedInAt": 1714499000 },
    { "id": "acc_def456", "label": "Work", "serverUrl": "https://kb.work.example", "lastLoggedInAt": 1714499500 }
  ]
}
```

Tauri commands:

```rust
#[tauri::command] async fn list_accounts(...) -> Vec<Account>;
#[tauri::command] async fn add_account(label: String, server_url: String, ...) -> Account;
#[tauri::command] async fn remove_account(account_id: String, ...) -> ();
#[tauri::command] async fn rename_account(account_id: String, new_label: String, ...) -> ();
```

Sessions (auth tokens) are stored separately in OS-native secure storage via `tauri-plugin-stronghold` or `keyring`; never in `accounts.json`.

### Window manager (`src-tauri/src/window_manager.rs`)

Each account gets its own window. Window labels encode the account id: `account-acc_abc123`.

```rust
#[tauri::command]
async fn open_account_window(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let label = format!("account-{}", account_id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let url = tauri::WebviewUrl::App(format!("index.html?account={}", account_id).into());
    tauri::WebviewWindowBuilder::new(&app, &label, url)
        .title(format!("Kryton — {}", account_label(&app, &account_id)?))
        .inner_size(1200.0, 800.0)
        .build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn focus_account_window(account_id: String, app: tauri::AppHandle) -> Result<(), String> {
    let label = format!("account-{}", account_id);
    if let Some(w) = app.get_webview_window(&label) {
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Window state (size, position) persisted via `tauri-plugin-window-state`, keyed per window label so each account remembers its own placement.

### React side: account resolution at boot

```tsx
// src/main.tsx
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const win = getCurrentWebviewWindow();
const label = win.label; // e.g. "account-acc_abc123" or "launcher"

if (label === "launcher") {
  // Render account picker (no Kryton instance yet)
  ReactDOM.render(<LauncherApp />, root);
} else {
  const accountId = label.replace(/^account-/, "");
  ReactDOM.render(<AccountWindow accountId={accountId} />, root);
}
```

A "launcher" window opens at app start if no accounts exist, OR if the user explicitly opened the launcher from the menu/tray. Otherwise, the app opens the most-recently-used account's window.

`<AccountWindow>` wires `<KrytonDataProvider adapter={coreAdapter}>` with a Kryton instance unique to this window's account id.

## Auth flow

Owned by the desktop app, NOT the UI library. Lives in `src/auth/`.

### First-run flow

1. App starts, no accounts in `accounts.json` → launcher window shows `<ServerSetup>` (input: server URL).
2. User enters URL, hits "Connect". Desktop calls `GET <serverUrl>/api/version` to verify a Kryton server.
3. On success: opens `<LoginScreen>` (email + password, with passkey/2FA buttons).
4. After successful login, server returns a session cookie. Desktop stores it via `keyring`/Tauri secure storage keyed by account id.
5. New account record added to `accounts.json`. Launcher closes; account window opens.

### Subsequent runs

1. App starts. Reads `accounts.json`; if accounts exist, opens the most-recently-used account's window.
2. Window's React app hydrates session token from secure storage, instantiates Kryton with `authToken: () => secureStorage.getToken(accountId)`.
3. If session is invalid (401 from server), Kryton reports auth error; desktop shows re-login modal in that window.

### Logout

Right-click account in tray → Log Out. Closes the window, clears the secure-storage token, leaves the local DB on disk so re-login is instant.

## Tier 1 native integrations

### Native menu bar (`src-tauri/src/menu.rs`)

macOS menu structure (Windows menu adds File/Edit/View; macOS automatically applies platform-correct shortcuts):

```
Kryton
  About Kryton
  Preferences... (⌘,)
  Services
  Hide Kryton (⌘H)
  Hide Others (⌘⌥H)
  Show All
  Quit Kryton (⌘Q)
File
  New Note (⌘N)
  New Window (⌘⇧N)         # opens launcher
  Open... (⌘O)              # file dialog → import
  Switch Account >          # submenu of accounts
  Close Window (⌘W)
Edit
  Undo (⌘Z), Redo (⇧⌘Z)
  Cut (⌘X), Copy (⌘C), Paste (⌘V), Select All (⌘A)
  Find in Note (⌘F)
View
  Toggle Sidebar (⌘B)
  Toggle Graph (⌘⇧G)
  Toggle Edit/Preview (⌘E)
  Show Daily Note (⌘D)
Window
  Minimize (⌘M), Zoom
  Bring All to Front
  (account window list, with checkmark on focused)
Help
  Kryton Documentation
  Show Logs in Finder
  Report an Issue
```

Menu actions dispatch via Tauri events; React listens via `<KeyboardShortcuts>` from `@azrtydxb/ui` and routes to handlers.

### File dialogs

Native dialogs via `@tauri-apps/plugin-dialog`. Used for:
- `File → Open...` — pick a `.md` file or folder, import into the current account.
- `File → Export Note...` — save current note as `.md` with frontmatter intact.
- `File → Export Vault...` — save entire account's notes as a `.zip`.

### Window state persistence

`tauri-plugin-window-state`. Saves size, position, maximized state per window label. Restored on next open.

### Auto-updater (basic wiring; full pipeline in sub-project 3)

`@tauri-apps/plugin-updater` configured to look at GitHub Releases. In this sub-project: just install and configure with a placeholder URL. Real release pipeline (signing, notarization, manifest generation) is in sub-project 3.

## App icon + dock menu

App icon: ship a Kryton-branded `.icns` (macOS) at multiple resolutions. Defer custom Windows `.ico` to sub-project 3.

Dock menu (right-click on dock icon): "New Note", "Account list submenu". Configured in `tauri.conf.json` + Rust callback.

## Sub-project boundaries

**In scope for this sub-project:**
- All of the above.
- macOS-only build, code signing for development (ad-hoc Apple signature, no notarization).
- Local dev workflow (`npm run tauri dev`).

**Out of scope (deferred to sub-project 3):**
- Tier 2 native integrations (system tray, global hotkey, deep links, drag-drop import).
- Tier 3 native integrations (notifications, Spotlight, Windows Search, Touch Bar, jumplist).
- Windows build + signing.
- Full release pipeline (notarization, signed Windows MSI, GitHub Release auto-publish).
- Plugin manager UI surface in desktop.
- Agents UI surface in desktop.
- Full settings panels (only Account + Appearance + Sync minimum in this sub-project).

## Testing strategy

- **Unit:** SqlJsAdapter against the existing adapter conformance suite from `@azrtydxb/core`. Persistence flush logic with mocked Tauri commands.
- **Integration:** dev-mode launch script that spins up a test Kryton server, opens a Tauri window, runs a smoke flow (login → create note → restart app → confirm note persists).
- **E2E:** deferred to sub-project 3 once the surface stabilizes.

## Open implementation questions

1. SQL.js bundle: ship the `.wasm` as a static asset in `public/`, or inline it via base64? Inline avoids a runtime fetch but bloats the JS bundle ~1MB. Default: static asset; Tauri serves it as `tauri://localhost/sql-wasm.wasm`.
2. Yjs websocket from desktop: same protocol as mobile (`@kryton/core`'s `YjsWebsocketConnector`). Confirm Tauri's WebView WebSocket is non-buggy for the binary frames; defer measurement to first dev run.
3. Auth: cookies vs bearer tokens. Better-auth issues both. Mobile uses bearer + secure store; desktop should match for consistency. Confirm during impl.
4. Window-close flush: Tauri's `before-close` event handler must be registered to call `persistence.flushNow()` synchronously. If the flush takes >2s the OS may force-kill — investigate worst case during impl.
