# `kryton-desktop` Complete — Design Spec

**Status:** Approved for implementation planning.
**Sub-project:** 3 of 3 in the desktop app track.
**Depends on:** sub-projects 1 (`@azrtydxb/ui`) and 2 (`kryton-desktop` core).

## Purpose

Bring the desktop app from "works on a Mac in dev mode" to "shippable, signed, auto-updating, feature-complete v1 release on macOS and Windows." Adds Tier 2 + Tier 3 native integrations, plugin and agent surfaces, the full release pipeline, and Windows support.

## Scope summary

| Area | Sub-project 2 status | This sub-project |
|---|---|---|
| Tauri shell, SqlJsAdapter, persistence | ✅ done | unchanged |
| Multi-account, multi-window, account store | ✅ done | unchanged |
| Tier 1 native (menu, file dialog, window state) | ✅ done | unchanged |
| Auth flow (server setup, login, secure storage) | ✅ done | minor polish |
| Tier 2 native (tray, global hotkey, deep links, drag-drop) | — | **add** |
| Tier 3 native (notifications, Spotlight, Win Search, Touch Bar, jumplist) | — | **add** |
| Plugin manager UI in desktop | — | **add** |
| Agents UI in desktop | — | **add** |
| Full settings panels | minimum (3 panels) | **add remaining** |
| Windows build + signing | — | **add** |
| Release pipeline (notarize, sign, GitHub Releases, updater manifest) | — | **add** |

## Tier 2 native integrations

### System tray

`@tauri-apps/plugin-tray` (Tauri v2 built-in). Tray icon shows when app is running (configurable: hide tray on macOS to follow Dock-only convention, or show always on Windows where tray is expected).

Tray menu structure:

```
[•] Personal     (focused)
    Open Window
    Quick Switcher (⌘⇧K)
    Sync Now
    ─────────
    Log Out
[ ] Work
    Open Window
    Quick Switcher (⌘⇧K)
    Sync Now
    ─────────
    Log Out
─────────
Add Account...
─────────
Show Launcher
Quit Kryton
```

Click on account name = open/focus that account's window. Account submenu actions are scoped to that account.

### Global hotkey

`@tauri-apps/plugin-global-shortcut`. Default binding: `CmdOrCtrl+Shift+K` opens quick switcher in the focused window. If no Kryton window is focused or visible, brings the most-recently-used account's window forward and opens quick switcher there.

User-configurable in Settings → Hotkeys panel. Implementation registers the chosen binding, validates conflicts with other apps' bindings via Tauri's API.

### Deep links (`kryton://` URI scheme)

`tauri-plugin-deep-link`. Registers `kryton://` URI on macOS (`Info.plist` URL scheme via `tauri.conf.json`) and Windows (registry entry).

URI patterns:

```
kryton://note/<encoded-path>?account=<id>           # open specific note
kryton://daily?account=<id>                          # today's daily note
kryton://search?q=<query>&account=<id>               # open search
kryton://settings/<section>?account=<id>             # jump to settings panel
```

If `account` is omitted, open in the most-recently-used account.

If the target account's window isn't open, deep link first opens the window, then routes to the destination.

### Drag-drop file import

Each window listens for Tauri's `tauri://file-drop` event. On drop:

- `.md` files: read the file via Tauri command, POST to `/api/notes` (current account's server) with the relative path derived from filename (sanitized) + frontmatter preserved. Sync brings it back into the local SQLite via the next pull.
- Folders: walk the directory, POST each `.md` file. Show a progress modal "Importing N files..."
- Other file types (`.png`, `.jpg`, `.pdf`): POST as attachment via `/api/attachments`, get a content hash, insert as `![](attachment://<hash>)` at the cursor position in the focused note.

Edge: dropping into the launcher window prompts "Choose account to import into" first.

## Tier 3 native integrations

### Native notifications

`@tauri-apps/plugin-notification`. Triggered on:

- **Sync complete** when changes were pulled from server (configurable: off/quiet/full).
- **Share invite received** — server pushes via WebSocket; desktop shows native notification "Pascal shared 'Project Plan' with you".
- **Agent-finished events** — when an agent the user owns completes a long-running task and signals via the awareness layer.

User-configurable per category in Settings → Notifications.

### macOS Spotlight integration

Goal: typing a note title into Spotlight returns it as a result; clicking the result deep-links into Kryton.

Implementation:

1. Tauri Rust code uses `core_spotlight` Apple framework via `objc2` bindings to register `CSSearchableItem` entries. One item per note: `uniqueIdentifier = note path`, `domainIdentifier = account-<id>`, `title`, `contentDescription = first 200 chars of note body`.
2. On Kryton sync events (`sync:complete`), Tauri side reads notes that changed and updates Spotlight index. Initial population on first launch indexes all notes.
3. Spotlight click invokes `kryton://note/<path>?account=<id>` deep link via `Info.plist` URL scheme registration.
4. Indexed content scoped to title + first 200 chars (CSSearchableItem doesn't index full text — that's CoreSpotlight's stance for performance).
5. On account logout: clear that account's Spotlight items via `CSSearchableIndex.deleteSearchableItems(withDomainIdentifiers:)`.

Real engineering: ~2 days of Swift FFI from Rust. Add `objc2 = "0.5"` and `objc2-core-spotlight = "0.2"` (or similar) to Cargo.toml. Test on real Spotlight (no good Spotlight emulator).

### Windows Search integration

Goal: equivalent to Spotlight via Windows Search Indexer.

Implementation:

1. Use `windows` crate (Rust bindings for Windows APIs). Register a `SearchIndexer` filter handler — but custom filter handlers require COM registration which is heavyweight.
2. Pragmatic alternative: write `.url` shortcut files into a folder Windows Search already indexes (`%LocalAppData%\Microsoft\Windows\Start Menu`) — one file per note, named after the note title, with the URL pointing to `kryton://note/<path>`. Windows Search picks up filenames and metadata.
3. Files removed/updated as notes change.
4. Less powerful than full content indexing, but achievable in days not weeks.

If full content indexing is later needed, register a proper IFilter handler — separate effort.

### macOS Touch Bar

`@tauri-apps/plugin-touchbar` (or build via objc2). Touch Bar shows:

- Current note title (read-only label, truncated)
- Sync status icon (green/red dot)
- "New Note" button
- "Toggle Edit/Preview" button

Lowest priority of all Tier 3 work — Apple deprecated the Touch Bar on M-series MacBooks. Some legacy Intel users still have it. Build last, or drop if scope tightens.

### Windows taskbar jumplist

Tauri's `@tauri-apps/plugin-taskbar` (planned plugin) or via `windows::Win32::UI::Shell::PropertiesSystem`. Jumplist shows:

- "Recent Notes" (last 5 opened notes, per account)
- "Tasks": "New Note", "Open Quick Switcher"

Right-click the Kryton taskbar icon to access. Implementation reads `lastOpenedAt` from the active account's Kryton instance via a Tauri command.

## Plugin manager UI

`<PluginManagerScreen>` from `@azrtydxb/ui` (extracted in sub-project 1) is mounted as a settings panel. Wired to the existing kryton-plugins registry.

Desktop-specific concerns:

- The plugin loader (in `@azrtydxb/ui`) uses `fetch()` to retrieve plugin code. Desktop's WebView has CSP that needs to allow `https://github.com/azrtydxb/kryton-plugins/...` raw content. Configured in `tauri.conf.json`.
- Plugins that load other resources (CDN scripts, images) are subject to the same CSP. Desktop's CSP defaults to "self + GitHub raw" for plugin assets; users can add origins via Settings → Plugins → Allowed Origins.
- No native API exposed to plugins (per Question 8 decision: plugin support, not native plugin API).

## Agents UI

`<AgentsScreen>` from `@azrtydxb/ui` is mounted as a settings panel. v1 surface (matching server-side capabilities from Phase 2):

- List agents (name, label, last-seen-at, token count).
- Create agent: form with name + label fields. Cedar policy text entered into a `<textarea>` (no rich editor in v1; deferred to v1.1).
- Per-agent: list active tokens (creation date, expiry, last used). Mint new token button → modal with "copy to clipboard" and 30-second visibility before hiding (token shown once, never recoverable).
- Revoke token / delete agent.
- Awareness presence: when an agent is editing a note in the focused window, the editor (already wired via Phase 2 yCollab) shows the agent's cursor with a distinct color and label.

## Full settings panels

In sub-project 2, only Account + Appearance + Sync are wired. Sub-project 3 mounts the rest from `@azrtydxb/ui`:

- Editor (font size, line wrapping, vim mode toggle, debounce ms).
- Notifications (per-category toggles).
- Plugins (list, install/uninstall, allowed origins).
- API Keys (existing — list/mint/revoke; same as web).
- Agents (per above).
- Privacy (telemetry off/on, crash reports off/on).
- Hotkeys (global + in-app).
- Advanced (data dir location, logs button, "factory reset this account").
- Diagnostics (sync state, errors, build hashes, "copy report to clipboard").

## Windows build + signing

### Build

GitHub Actions matrix adds `windows-latest` runner. Tauri's CI integration (`tauri-action`) handles building MSI + NSIS installers. Generated artifacts:

- `kryton-windows-x64.msi`
- `kryton-windows-x64-setup.exe`

### Signing

EV code-signing certificate (purchased separately by repo owner). Stored as repo secrets:
- `WINDOWS_CERT_BASE64` — PFX file base64-encoded
- `WINDOWS_CERT_PASSWORD`

Signing step uses `signtool.exe` (preinstalled on `windows-latest`) before MSI/EXE upload. Tauri-action handles invocation.

### Auto-updater (Windows)

Same `latest.json` manifest mechanism as macOS, served from GitHub Releases. Tauri's updater plugin reads the manifest, verifies signature against the bundled public key, downloads + applies update.

## Release pipeline

### `release.yml` workflow (in kryton-desktop)

Trigger: push of `v*` tag (matches version in `package.json` and `tauri.conf.json`).

Jobs:

1. **build-macos** (`macos-latest`):
   - Install Rust + Node.
   - `npm ci`.
   - `npm run build` (compiles SQL.js wasm asset, builds React).
   - `npm run tauri build`.
   - Sign `.app` with Apple Developer cert (`APPLE_CERTIFICATE` + `APPLE_CERT_PASSWORD` secrets).
   - Notarize via `notarytool` with `APPLE_NOTARY_USER`, `APPLE_NOTARY_PASSWORD`, `APPLE_TEAM_ID` secrets.
   - Staple notarization ticket.
   - Output: `Kryton.dmg`.

2. **build-windows** (`windows-latest`):
   - Install Rust + Node.
   - `npm ci`.
   - `npm run tauri build`.
   - Sign MSI + EXE with EV cert.
   - Output: `kryton-windows-x64.msi`, `kryton-windows-x64-setup.exe`.

3. **release** (after both builds):
   - Create GitHub Release at the tag.
   - Upload all artifacts.
   - Generate `latest.json` manifest with version, signed download URLs, and Tauri updater signature (signed via `TAURI_PRIVATE_KEY` secret — generated via `tauri signer generate`).
   - Upload `latest.json` to the release.

### Updater key generation

One-time setup: run `tauri signer generate` locally, store private key in `TAURI_PRIVATE_KEY` secret, commit public key to `tauri.conf.json` `updater.pubkey` field. Updater verifies downloads against this public key.

## Distribution

- **GitHub Releases** as primary channel for v1.
- README install instructions: macOS users download `.dmg`, drag to Applications. Windows users download `.msi` or `.exe`, run installer.
- **No Mac App Store, no Microsoft Store** in v1. Both have review processes incompatible with weekly release cadence.
- **Homebrew cask** as v1.1 nice-to-have: a community-maintained cask points at the latest GitHub Release `.dmg`. Defer.

## Telemetry / privacy

Per Question 9 (presented in design summary): zero default telemetry, opt-in crash reporting only.

- Settings → Privacy:
  - Crash reports (off / send anonymized / send with user identifier) — default off.
  - "Show data directory in Finder" button.
  - "Export all data" button (ZIP of accounts + databases + logs).
  - "Delete all local data" button (with multi-step confirmation).

If crash reporting toggled on, desktop initializes `@sentry/electron` (works for Tauri too) with the user's chosen identifier mode. DSN points at a kryton-owned Sentry project (or self-hosted Sentry — left to operator).

## Out of scope for v1 (entire desktop sub-project)

- Linux build (deferred to v1.1).
- Mac App Store + Microsoft Store distribution.
- Beta/nightly auto-update channels.
- Native plugin API (plugins use WebView APIs only).
- Within-window account switching.
- Touch Bar polish (basic implementation only; no live updates while typing).
- Multi-language localization (English-only).
- Right-to-left language support.
- Accessibility audit (works at WCAG AA level by virtue of using `@azrtydxb/ui`'s components, but no formal audit).
- Performance optimization for >50,000 notes per account.

## Testing strategy

- **Unit:** Tauri command logic with `mockTauri()` shim. Window manager state. Persistence edge cases (concurrent flushes, disk full, permissions denied).
- **Integration:** Tauri dev mode + test server. Smoke flows: login → create note → quit → restart → resume; deep link → open note; drag-drop import; tray click → focus window; account switch.
- **E2E:** WebDriverIO with `tauri-driver` for end-to-end automation. CI runs these on macOS-latest only (Windows tauri-driver is less mature).
- **Manual smoke checklist:** OS-specific features (Spotlight indexing, Windows Search shortcuts, notifications) tested by the operator on real hardware before each release.

## Open implementation questions

1. Spotlight indexing batch frequency — sync triggers reindex of changed notes only. On a 10k-note initial population, batching 100 items per CSSearchableIndex transaction. Tune during implementation.
2. Whether to ship a 32-bit Windows binary alongside x64. Default: x64 only; 32-bit Windows is rare.
3. Auto-update behavior: silent download + notify-on-restart? Or prompt before download? Default: silent download, notify on app quit "Updates installed; restart to apply." User-configurable.
4. Plugin CSP allowlist UI — Settings → Plugins → Allowed Origins or per-plugin allow? Default: per-plugin during install (plugin manifest declares origins, user approves at install time).
