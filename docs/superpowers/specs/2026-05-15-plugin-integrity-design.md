# Plugin Install/Load Integrity Boundary — Design Spec

**Status**: Proposed
**Date**: 2026-05-15
**Owner**: Platform / Security
**Related**: audit finding on supply-chain trust in the plugin pipeline

## 1. Goal

Establish a verifiable trust boundary for plugin installation and loading on both the Kryton server and Kryton client. After this work lands, an admin installing a plugin from the registry must be able to answer four questions before any third-party code touches the host process:

1. **Provenance** — who produced this artifact?
2. **Integrity** — is the bytes-on-disk exactly what was published?
3. **Authority** — what subset of the host's API does this plugin actually need?
4. **Containment** — if it misbehaves, what can we kill, and what damage radius is the blast?

Today none of those questions have a satisfying answer. This doc proposes the boundaries, evaluates options, and recommends a phased composition. It is design-only — no code changes ship with this PR.

## 2. Why now

The recent audit flagged the plugin pipeline as the single largest unmanaged trust gap in the codebase. Two paths in particular accept untrusted code with no integrity check:

- **Server install + load** — `packages/server/src/modules/plugins/services/registry.service.ts:122` downloads plugin files from `github.com / raw.githubusercontent.com / api.github.com` and writes them straight to the plugins directory. `packages/server/src/modules/plugins/services/manager.ts:152` then `require()`s the resolved server entry. The only checks between "bytes off the network" and "code executing in the host process" are (a) a hostname allowlist and (b) a path-traversal guard on the manifest's `server` field.
- **Client import** — `packages/client/src/plugins/PluginManager.ts:130` calls `await import(/* @vite-ignore */ info.client)` against the URL the server advertises. The browser fetches the bundle from our own origin (served by `@fastify/static` in `packages/server/src/modules/plugins/index.ts:193`), so a tampered bundle on disk becomes same-origin executable JS in every user's tab — full XSS-equivalent.

The fact that install is admin-only narrows *who* can introduce a malicious plugin, but it does not narrow *what* the plugin can do, and it does not protect users against a compromised registry repo or a man-in-the-middle on the GitHub fetch. Admin-gated does not equal trustworthy.

We're also approaching a point where third-party plugins from the registry will be encouraged (the `azrtydxb/kryton-plugins` repo is public, contributions invited). Locking down the trust boundary *before* the ecosystem grows is meaningfully cheaper than retrofitting after.

## 3. Threat model

Concrete adversaries and the attacks we want this boundary to defeat or contain.

### T1 — Malicious plugin from a compromised registry repo
The GitHub account hosting `azrtydxb/kryton-plugins` is compromised, or a maintainer's branch protection is bypassed. A new release of a popular plugin carries a backdoor that calls home, exfiltrates notes, or installs a reverse shell.
**Today**: zero defense. The install flow trusts the latest commit on master.
**We want**: tamper-evident signal that this artifact differs from the one a release manager actually approved.

### T2 — MITM tampering during download
The server's TLS chain to GitHub is somehow degraded (corporate proxy with rewriting, compromised CA in the trust store, downgrade attack). An attacker substitutes plugin bytes in flight.
**Today**: only TLS protects us; no end-to-end integrity check after bytes land on disk.
**We want**: integrity check that doesn't rely on transport security being unbroken.

### T3 — Tampered bundle served back to the browser
A plugin's `client/index.js` is modified on disk (compromised host, malicious sibling plugin, supply-chain attack on a dependency that wrote into the plugin dir). The bundle is served same-origin via `@fastify/static`. Every user loading the app receives malicious JS with full app-origin authority — cookies, IndexedDB, the entire DOM.
**Today**: zero defense beyond filesystem permissions on the host.
**We want**: browser refuses to execute unless the bundle hash matches a known-good value.

### T4 — Plugin abusing API surface beyond declared intent
A "markdown table beautifier" plugin silently calls `api.notes.list(otherUserId)` for any user ID it can guess or harvest from other API calls, or `api.notes.readNote(otherUserId, "secrets.md")` for a specific known target, or `api.storage` to mine global state, or registers a route that exposes admin data. `NoteService.list` takes a concrete `userId` and joins it into a filesystem path, so the abuse isn't a wildcard scan — it's that *any* authenticated plugin context can read *any* user's notes given the userId, with no scope check.
**Today**: every plugin gets the *complete* `PluginAPI` from `api-factory.ts:50` — full notes read/write, full storage, full search index, arbitrary route registration. No declaration, no enforcement.
**We want**: plugins declare needed scopes; the API factory only wires the surface they asked for and the admin consented to.

### T5 — Privilege escalation via missing permission enforcement
A plugin with read-only intent calls `api.notes.update`. Nothing stops it. Worse, `api.routes.register` lets a plugin mount `/api/plugins/foo/admin/wipe-users` and process arbitrary requests under the host's auth context.
**Today**: route registration is unbounded; the `requireAdmin` preHandler only gates lifecycle endpoints, not plugin-registered routes.
**We want**: route registration goes through the same scope gate, and plugin-mounted routes inherit a least-authority subset.

### T6 — Persistence after revoke
Admin uninstalls a plugin. `plugins.routes.ts:386` removes the directory and the DB row, but if the install ever cached a bundle elsewhere (build artifacts, hot-swap module cache, browser disk cache for the static JS URL), the code can keep running until the next restart / cache eviction.
**Today**: `require.cache` is busted (`manager.ts:223`), but there is no purge of browser-side caches and no audit log of what got removed.
**We want**: revoke is total and observable. Cached bundles are explicitly invalidated; the DB record of "we used to trust this checksum" persists for forensics.

### Out of scope (for this doc)
- Compromised host machine with root — once the OS is owned, no application-layer boundary helps.
- Side-channel attacks (CPU timing, Spectre-class). Real but disproportionate cost for this codebase.
- Denial-of-service inside the plugin's own loop (covered by the existing `healthMonitor` work).

## 4. Current state inventory

What we already do, with file:line citations, followed by what's missing.

### What exists today

| Protection | Location | Effect |
|---|---|---|
| Hostname allowlist | `registry.service.ts:4-16` | Downloads only from `github.com`, `raw.githubusercontent.com`, `api.github.com`. |
| `.ts` source skip | `registry.service.ts:191` | Server won't fetch raw TypeScript; expects compiled `.js` (and `.d.ts`). |
| Path-traversal guard on `manifest.server` | `manager.ts:138-143` | `serverEntry` must resolve under `pluginDir`. |
| Path-traversal guard on `pluginId` | `pluginsRoutes` via `validatePluginId` (`plugins.routes.ts:150, 181, 207, 294, 336, 379`) | Rejects `..`, slashes, control chars in URL params. |
| Admin-only install / enable / disable / uninstall / update | `plugins.routes.ts` preHandlers using `app.auth.requireAdmin` | Only admins can introduce new plugin code. |
| Activation timeout | `manager.ts:43, 172-180` | Bounds *async / non-resolving* `activate()` calls only. The plugin's `mod.activate(api)` is invoked synchronously before the timeout promise is even created, so a synchronous infinite loop or CPU-bound work inside `activate()` blocks the event loop and the timeout never fires. Real containment of CPU-bound abuse requires `worker_threads` or a separate process — see §5.4 and §6. |
| Sticky `enabled` flag | `manager.ts:74, 287` | Disabled plugins stay disabled across boots. |
| Module-cache invalidation on unload | `manager.ts:217-227` | `require.cache` is cleared so reload picks up new code. |
| `validatePathWithinBase` on notes API | `api-factory.ts:99` | Prevents plugin from escaping a user's notes directory. |

### What is missing

1. **No integrity check at download time.** `downloadFileBytes` (`registry.service.ts:163`) writes whatever came back from the URL, with no hash, no signature, no version pinning, no comparison to a manifest of expected bytes.
2. **No integrity check at load time.** `manager.ts:152` calls `require(serverEntry)` against whatever is on disk now. If something modified the file after install (another plugin, an OS-level attacker, a botched concurrent update), we'd never know.
3. **No permission manifest.** `PluginManifest` (`types.ts:13`) has `settings` and that's the only declarative field. Plugins do not declare what API surface they intend to touch.
4. **No API-level enforcement.** `PluginApiFactory.createApi` (`api-factory.ts:50`) hands every plugin the same fully-wired API object. There is no policy layer.
5. **No process isolation.** `mod = require(serverEntry)` (`manager.ts:152`) runs the plugin in the host's Node process. Throwing inside `activate()` is caught; doing `process.exit(1)` is not.
6. **No client-side integrity.** `PluginManager.ts:130` does `import(info.client!)` with `info.client` being a host URL. No SRI, no hash check, no allowlist of expected bundles.
7. **No revoke audit.** Uninstall (`plugins.routes.ts:386-396`) deletes the directory and the row; no forensic trail of "this checksum was active from X to Y."
8. **Static file serving has no scoping.** `@fastify/static` at `index.ts:193` serves the entire `pluginsDir` under `/plugins/`. A plugin that smuggles a non-`client/` asset into its directory can have it fetched by any client.
9. **No version pinning.** `downloadPlugin` always fetches latest from `master` of the registry repo. There is no record of *which commit* was installed, so reproducing or auditing a known-good install is impossible.

## 5. Proposed boundaries — option analysis

Six candidate mechanisms. Each is evaluated on what it defeats, what it costs, and where it stops.

### 5.1 Signature-based release verification

**Mechanism.** Plugin maintainers sign each released artifact (typically a tarball of `manifest.json` + compiled bundles) with an offline private key. The signature is published alongside the release. The server holds the corresponding public key (pinned, bundled with Kryton, or distributed via a trust-on-first-use mechanism). On install, the server verifies the signature before unpacking; mismatched signature → install fails.

**Defeats**: T1 (compromised repo), T2 (MITM), most of T6 (we can record "valid signature observed at time T").

**Costs.**
- Key management UX. Whose key? Per-plugin author, or a single registry-curator key? Per-plugin makes the trust model honest but explodes the key inventory. Per-curator centralizes trust in one keyholder.
- Revocation is famously hard. A leaked key requires a revocation list mechanism, which itself needs distribution.
- Build pipeline changes for every plugin author. Friction for ecosystem growth.
- Signing tooling has to be runnable offline; key custody has to be airgapped to be meaningful, otherwise an attacker who compromises CI compromises signing too.

**Stops at.** Does not constrain *what* a verified plugin can do at runtime. A signed-but-malicious plugin from a compromised author key still owns the host process.

### 5.2 Checksum pinning (a "lockfile" for plugins)

**Mechanism.** The registry index (`registry.json` in `azrtydxb/kryton-plugins`) is extended so each plugin/version entry carries a `sha256` of the canonical artifact (e.g. a tarball or a manifest of per-file hashes). On install, the server computes the hash of what it downloaded and compares to the pinned value. Mismatch → fail closed, do not write to `pluginsDir`. The installed-plugin DB row stores the pinned hash, and `loadPlugin` re-verifies on every boot before `require()`.

**Defeats**: T6 partially (we keep the historical hash on uninstall for audit), plus on-disk / post-install tamper detection (catches T3-adjacent local modification and the "another process rewrote the file after install" case). **Does not defeat T2 on its own** when the hash is served inline in the same `registry.json` fetched from the same GitHub channel as the artifact — an attacker who can rewrite the bytes in flight can also rewrite the matching hash in flight. Defeats T1 *only* if the registry index itself is updated independently of the plugin artifact (i.e. registry index commits are protected even if a plugin author's branch isn't). Genuine T2 defense requires the hash to come from an **independent trust anchor**: a signed registry index, a lockfile bundled and pinned with the Kryton release, or a separate authenticated channel. This is flagged as an open question in §12.

**Costs.**
- Need a source of truth for the hashes. Two options:
  - **Inline in registry.json**, maintained by the registry curator on each release. Simple, but the curator becomes a trust anchor *and* the hash shares its trust channel with the artifact — so this option does nothing against T2.
  - **Per-release `checksums.txt`** committed alongside the plugin sources. Avoids centralization but harder to verify "did the curator approve this?" — and still shares the GitHub trust channel.
- Real T2 defense needs an independent anchor (see above). Pairs naturally with 5.1 (signed registry index) or with a Kryton-shipped lockfile.
- First-install is still trust-on-first-use: if the registry repo is compromised at the moment of first publication, the wrong hash gets pinned. Pairs naturally with 5.1 (signed registry index) to close this.
- Need a backfill story for plugins installed before this lands (see §10).

**Stops at.** Does not constrain runtime behavior. Same as signatures: integrity ≠ authority.

### 5.3 VM sandbox (`node:vm`)

**Mechanism.** Instead of `require(serverEntry)`, read the file as text, wrap in `vm.Script`, run in a `vm.Context` populated only with the explicit globals we want the plugin to see (no `process`, no `require`, no `Buffer`, no `fetch` unless granted). The `activate()` function gets the same `PluginAPI` it does today, but cannot reach outside.

**Defeats**: T4, T5 *partially* — plugin can't `import("fs")` to bypass the API surface.

**Costs.**
- `vm` is not a security boundary. The escape literature is well-known: proxy poisoning, prototype walks, async leaks via timers. Mitigations exist (frozen prototypes, no async callbacks holding host references) but every release of V8 risks new escape vectors.
- Server-side only. Does nothing for T3.
- Performance: re-parsing on every load is a real cost for large plugins. Snapshot caching helps but adds complexity.
- Existing plugins use `require()` for their own deps (e.g. the mass-upload plugin imports lodash-ish helpers). A `vm.Context` without `require` breaks them. We'd need to wire a curated `require` shim.

**Stops at.** Same-process. A `while(true){}` inside the VM still pegs a CPU core.

### 5.4 Process isolation (`worker_threads` or child process)

**Mechanism.** Each plugin's server module runs in its own `Worker` thread (or `child_process.fork`). The host communicates via `MessagePort` / IPC. The `PluginAPI` becomes an RPC proxy: the plugin worker sends `{op: "notes.list", args: [...]}`, the host validates against the granted scopes, executes, returns.

**Defeats**: T4, T5, T6 (kill the worker = code stops, deterministically). Partial mitigation of in-process attacks (memory disclosure, prototype pollution on the host).

**Costs.**
- IPC overhead on every API call. For chatty plugins this matters.
- Plugin authoring complexity goes up: synchronous handlers become async, the API needs a serialization story (DB result objects, dates, Buffer all need careful handling).
- Engineering cost is substantial — every method on `PluginAPI` needs an RPC counterpart.
- Doesn't help the client at all.

**Stops at.** A plugin worker is still a Node process with `fs` and `net` unless we further sandbox it. The Node-native option is the experimental permission model: launch the worker (or the host) with `--experimental-permission` and grant only the scopes the plugin manifest declares via `--allow-fs-read=<paths>`, `--allow-fs-write=<paths>`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, etc. (Note: `--no-experimental-permission` is the *disable* flag and would defeat the model.) OS-level sandboxes — AppArmor, seccomp, SELinux — are complementary and tied to deployment topology.

### 5.5 Permission manifest enforced at the API layer

**Mechanism.** Extend `PluginManifest` with a `permissions` field listing scoped capabilities. On install, the admin sees the list and consents. On load, `PluginApiFactory.createApi` consults the granted scopes and either omits, no-ops, or throws on methods the plugin did not request. Route registration (`api.routes.register`) is gated by a `network` scope; storage access by `storage`; notes by `notes.read` / `notes.write`; etc.

**Defeats**: T4, T5. Principle of least privilege. Even a fully-compromised plugin with a valid signature cannot do more than its declared scopes allow.

**Costs.**
- Only as strong as the enforcement points. Every method on `PluginAPI` needs a scope check at the *factory edge*, not at the callsite, because once the plugin holds the function reference it bypasses any per-call check.
- Plugin author UX: existing plugins need to declare their scopes. Migration is mechanical but real.
- "Most plugins ask for everything" is a known failure mode of permission systems. Mitigations: UI that highlights wide scopes, periodic re-consent on update if scopes expand.

**Stops at.** Doesn't help against escapes from the in-process API to raw Node APIs (`require("fs")`) — that needs 5.3 or 5.4.

### 5.6 Subresource Integrity for client bundles

**Mechanism.** At install time, the server hashes *every* file the client bundle can request — not just `client/index.js` — and persists a manifest of `{ path, sha256 }` entries (`client-manifest.json`). This is necessary because ESM bundles routinely load additional chunks at runtime (code splitting, dynamic `import()` of feature modules, CSS-in-JS asset URLs, JSON imports). Hashing only the entry file leaves every secondary chunk unverified, and rewriting the entry's URL to a `blob:` URL changes the base URL so the relative imports break entirely.

Two enforcement options:
- (a) **Single-file constraint.** Require plugin client bundles to be a single file with no code splitting and no runtime asset loading. Plugin authors must bundle to one self-contained module. Simple, but a real constraint on the plugin authoring model and easy to violate accidentally.
- (b) **Per-asset integrity manifest (recommended).** Server stores `client-manifest.json` mapping every shipped client asset to its `sha256`. The server enforces the manifest on every request under `/plugins/<id>/client/...` — any path not in the manifest 404s, any byte mismatch 409s. The client verifies the entry file against the advertised hash (as today) but trusts subsequent same-origin fetches because the server gate-keeps them.

Recommend (b): it composes naturally with code-split bundles, doesn't constrain plugin authoring, and keeps the original URL as the cache key (so HTTP caching works). It's also the right answer for tampered secondary chunks — without the manifest, a modified non-entry chunk would execute with no hash check whatsoever. Tracked as an open question in §12.

**Defeats**: T3.

**Costs.**
- Adds a per-install hashing step over the full `client/` tree.
- Hashes need to update on every plugin update; client must invalidate on hash change.
- Server has to consult the manifest on every static-file request under `/plugins/<id>/client/...`. Cheap (in-memory map lookup) but a new hot path.
- Source maps either ship with their own manifest entries or are stripped at install time.

**Stops at.** Doesn't help server side.

## 6. Recommended composition

No single mechanism above is sufficient on its own. Defense in depth requires layering. The recommendation is a phased rollout with three composed boundaries, each addressing a distinct class of threat:

### Phase A — Integrity at install + load (defeats parts of T1, T6, plus on-disk / post-install tamper detection)

- **Checksum pinning** (5.2) as the base layer. Registry index carries per-version `sha256`. Server verifies on download, persists the hash to the `installedPlugin` row, and re-verifies on every `loadPlugin` before `require()`. Mismatch → state goes to `error`, plugin does not load.
- **Pinned version commit**. Install records the *registry commit SHA* alongside the artifact hash so reproducing an install is trivial.

Important scope note: as long as the `sha256` lives inline in `registry.json` served from the same GitHub channel as the artifact, this phase **does not defeat T2 (MITM)** — an attacker rewriting the bytes can rewrite the matching hash. What it *does* buy is post-install / on-disk tamper detection (every `loadPlugin` re-verifies against the stored hash, so anything that mutated files after install fails closed) and a forensic anchor for T6. Full T2 defense requires the hash source to come from an independent trust anchor (signed registry index, a lockfile bundled and pinned with the Kryton release, or a separate authenticated channel) — see §12 open questions.

This is the lowest-effort, highest-value layer. It can ship without changing the plugin authoring model.

### Phase B — Authority at the API boundary (defeats T4, T5)

- **Permission manifest** (5.5). New `permissions` field on `PluginManifest`. `PluginApiFactory.createApi` becomes scope-aware: methods the plugin didn't request are absent from the API object. Route registration requires `network` scope; cross-user storage requires `storage.global`; notes operations split into `notes.read` and `notes.write`; etc.
- **Admin consent UX**. Install flow shows the permission list and the hash. Updates that *expand* permissions require re-consent.

This is the most user-visible piece and the hardest to design well, because the scope grammar has to be expressive enough to be useful but stable enough that plugins don't churn their manifests.

### Phase C — Client integrity (defeats T3)

- **Per-asset integrity manifest** (5.6 option b). Server walks the full `client/` tree at install time and writes a `client-manifest.json` of `{ path, sha256 }` entries. The entry-file hash is exposed via `/api/plugins/active`; the rest of the manifest is server-internal.
- **Server-side enforcement at the static layer.** Every request under `/plugins/<id>/client/...` is gated by the manifest: paths not present 404, hash-mismatched bytes 409. This catches tampered secondary chunks (code-split bundles, CSS, JSON imports) that an entry-file-only hash would miss.
- **Client-side entry verification.** `PluginManager.ts` fetches the entry bundle, computes SHA-256 via `crypto.subtle.digest`, compares to the advertised hash. On match, the original same-origin URL is used for `import()` (the server has already gate-kept every subsequent fetch, so a `blob:` URL — which would break relative chunk imports — is not needed).

Phase A and Phase C are largely independent and could ship in either order. Phase B depends on the install flow knowing about scopes, so Phase A's install-time admin-consent UI is a natural home for it.

### Explicitly deferred

- **Signature verification (5.1)** — strong defense, expensive UX. Recommend revisiting once the ecosystem has more than a handful of plugins. Until then, the registry curator's GitHub branch protection plus checksum pinning is the operative trust model.
- **Process isolation (5.4)** — high engineering cost, high runtime cost. Worth it once we have evidence of misbehaving plugins or once the ecosystem includes plugins from authors we don't know personally. Tracking issue, not in the initial rollout.
- **VM sandbox (5.3)** — explicitly rejected. The escape risk plus the plugin-authoring friction does not justify the marginal benefit over 5.5 + 5.4.

## 7. Per-layer implementation sketch

File-level outline of where changes land. No code in this doc.

### Phase A — checksum pinning

1. **Registry schema (`azrtydxb/kryton-plugins` repo, not this codebase).** Each entry in `registry.json` gains `sha256` (hex string) and `releasedAt` (ISO date). Curator computes these at release time. Out of scope for this PR but mentioned because the server change depends on it.
2. **`registry.service.ts`**: extend `RegistryPlugin` with `sha256` and `releasedAt`. `downloadPlugin` becomes `downloadPlugin(pluginId, version, expectedHash, registryCommit, targetDir)` and returns the actually-observed hash. The `registryCommit` is the SHA of the `azrtydxb/kryton-plugins` commit the admin reviewed at `/registry` time — every GitHub contents API URL the function builds is suffixed with `?ref=<registryCommit>` so the download is pinned to that exact tree, not the default branch. Without this, the recorded `registryCommit` would be a passive observation rather than a reproduction anchor, and a registry mutation between `/registry` and `/install` could only fail via hash mismatch instead of fetching the artifact the admin actually saw. Internally:
   - Download into a temp directory, every fetch pinned to `?ref=<registryCommit>`.
   - Hash the canonicalized output (file-tree hash: sorted list of relative-path + per-file sha256, then hash that manifest).
   - Compare to `expectedHash`. On mismatch, delete temp dir, throw.
   - On match, atomically move temp dir to `<pluginsDir>/<id>`.
3. **DB schema (`installedPlugin` table)**: add `sha256` (text, nullable for back-compat) and `registryCommit` (text, nullable). Migration is a non-destructive `ALTER TABLE`.
4. **`manager.ts loadPlugin`**: before the `require(serverEntry)` call, recompute the file-tree hash, compare to the stored `sha256`. Mismatch → `state = "error"`, persist with a distinct `error` string like `integrity_mismatch`, do not load. (This catches T6 leftovers and post-install tampering.)
5. **`plugins.routes.ts install/:id`**: the request body now carries the `registryCommit` the UI displayed; the handler passes it through to `downloadPlugin` (together with `version` and `expectedHash`) and writes the observed hash + registry commit into the DB row.
6. **Feature flag**: a new server config option `pluginIntegrity: "off" | "warn" | "enforce"` so dev environments can warn-only while production enforces.

### Phase B — permission manifest

7. **`types.ts PluginManifest`**: add `permissions: PluginPermission[]` (schema in §8). Validate at install with a zod schema before writing anything to disk.
8. **`api-factory.ts createApi`**: rewrite to take both manifest and granted scopes. Each sub-API (`notes`, `events`, `routes`, `storage`, `settings`, `search`) is **always present on the returned object**, but methods outside granted scopes throw a typed `ScopeError("plugin lacks '<scope>' scope")` at call time. The reason for "present but throwing" over "absent": absence produces a generic `TypeError: Cannot read properties of undefined` at the call site, which is opaque to admins reading logs and indistinguishable from a real bug. Throwing `ScopeError` gives admins a clean error message, surfaces the scope failure at the exact callsite, and lets the manager catch and report it as a scope violation rather than a crash. This contract is consistent with §8 ("Scope semantics" → "throwing stub over silent undefined") — both sections now agree.
9. **`plugins.routes.ts install/:id`**: response includes the requested permissions. UI shows them; install requires an explicit `acceptPermissions: true` flag in the request body to proceed. Updates that *broaden* scopes set a `requiresReconsent: true` flag on the DB row; the plugin loads in `state: "needs_consent"` and remains inert until the admin re-confirms.
10. **`plugin-router.ts`**: route registration goes through a scope check before it's accepted. `api.routes` is present on every plugin's API object regardless of scopes — `register()` itself checks the `network` scope and throws `ScopeError("plugin lacks 'network' scope")` if absent. A plugin without `network` scope therefore gets a clean, named error at the `api.routes.register(...)` callsite during `activate()`, not a generic `TypeError` from accessing a property of `undefined`.

### Phase C — client integrity

11. **`registry.service.ts downloadPlugin`**: after the file-tree extraction, walk the entire `client/` subtree and emit a `client-manifest.json` of `{ path, sha256 }` entries (path relative to the plugin's `client/` directory). Also store the entry-file (`client/index.js`) hash separately in DB column `clientSha256` for the advertised-hash flow.
12. **`plugins.routes.ts /active`**: include `clientSha256` (entry-file hash) in the response. The full per-asset manifest stays server-internal.
13. **`client/src/plugins/PluginManager.ts loadPlugin`**: fetch the entry bundle as `Response`, read as `ArrayBuffer`, `crypto.subtle.digest("SHA-256", buf)`, hex-compare to the advertised hash. On match, `import()` the original same-origin URL — subsequent relative chunk imports are gate-kept by the server (step 14), so a `blob:` URL is unnecessary and would break relative imports. On mismatch, log + skip + report back via the existing WebSocket channel.
14. **Static serving (`packages/server/src/modules/plugins/index.ts`)**: narrow the `@fastify/static` root from `pluginsDir` to a per-plugin `client/` subpath, then wrap it in a preHandler that consults the in-memory `client-manifest.json` for the requested plugin. Paths not in the manifest → 404. Path present but on-disk bytes hash to something other than the recorded `sha256` → 409 `integrity_mismatch`. Add a `setHeaders` hook that emits `Cache-Control: no-cache` for plugin bundles so a stale browser cache cannot survive a hash-mismatch event.

### Cross-cutting

15. **Logging / audit**: every install, update, uninstall, and integrity-failure event is logged at info level with `pluginId`, `version`, `sha256`, `registryCommit`, `actorUserId`, `outcome`. Format aligns with whatever the audit-log subsystem ends up being.
16. **Tests**: integration tests in `packages/server/src/modules/plugins/__tests__/` for hash-match, hash-mismatch, permission-grant, permission-violation, and post-install-tamper detection. Client tests covering blob-URL import path.

## 8. Permission manifest schema proposal

Concrete shape. JSON in `manifest.json`, mirrored as a zod schema server-side.

```json
{
  "id": "example-plugin",
  "name": "Example",
  "version": "1.0.0",
  "permissions": [
    {
      "scope": "notes.read",
      "scopeDetails": { "userScope": "current" },
      "reason": "Reads the currently-open note to render a preview."
    },
    {
      "scope": "notes.write",
      "scopeDetails": { "userScope": "current" },
      "reason": "Writes back the user's edits to the open note."
    },
    { "scope": "storage", "reason": "Caches preview HTML per note." },
    { "scope": "network", "reason": "Mounts /api/plugins/example/preview." },
    { "scope": "search.read", "reason": "Reads the search index." }
  ]
}
```

### Scope grammar

| Scope | Grants | Notes |
|---|---|---|
| `notes.read` | `api.notes.get`, `api.notes.list` | `scopeDetails.userScope` is `"current"` (only the logged-in user) or `"all"` (any user; admin-only plugins). |
| `notes.write` | `api.notes.create`, `update`, `delete` | Same `userScope` distinction. |
| `storage` | `api.storage.*` for this plugin's namespace | Scoped to `pluginId`; cross-plugin storage is never granted. |
| `storage.global` | `api.storage.*` with `userId=null` | Separate scope because admin/global storage is a fatter target. |
| `settings.read` | `api.settings.get` | Plugin-scoped only. |
| `network` | `api.routes.register` | Required to mount any HTTP route under `/api/plugins/<id>/...`. |
| `search.read` | `api.search.query` | Read-only over the search index. |
| `search.write` | `api.search.index` | Required to mutate the index. |
| `events.subscribe` | `api.events.on` | Required at all (today every plugin gets this for free). |

### Scope semantics

- **Throwing stub over silent undefined.** Every sub-API (`notes`, `events`, `routes`, `storage`, `settings`, `search`) is present on the API object passed to `activate()` regardless of granted scopes. Methods outside the granted scopes throw a typed `ScopeError("plugin lacks '<scope>' scope")` at call time. Rationale: making the sub-API absent (i.e. `api.storage === undefined`) produces a generic `TypeError: Cannot read properties of undefined` at the callsite, which is opaque to admins reading logs and indistinguishable from a coding bug. A `ScopeError` thrown by the stub gives admins a clean named error, points at the exact missing scope, and is something the manager can catch and report as a scope violation. Authors still discover the missing scope at first call during development — they just get a better error message.
- **`reason` is mandatory** and is shown to the admin verbatim during install consent. Keeps authors honest.
- **Wildcard scopes are not provided.** No `notes.*`. Plugins enumerate what they need.
- **Forward-compat unknown scopes**: if the manifest declares a scope the server doesn't recognize, install fails. This is intentional — silently dropping unknown scopes would let a future malicious manifest claim authority by typoing.

### Versioning the grammar

A `manifestVersion` field on the manifest (defaulting to `1` if absent) bounds the scope grammar a plugin can use. When we evolve the grammar, we bump `manifestVersion`. The server refuses to install a manifest whose version it does not understand. This keeps the trust contract explicit.

## 9. UX — how admins consent

### Install screen (Phase B)

Modal dialog triggered by `POST /api/plugins/install/:id`. Body shows:

- Plugin name, version, author.
- Integrity block: `sha256` (truncated, full on hover), registry commit (link to GitHub commit).
- Permissions list: scope + reason for each. Scopes flagged as "wide" (`notes.write` with `userScope: "all"`, `storage.global`, `network`) get a visual marker.
- Two buttons: **Cancel** and **Install with these permissions**.

The install endpoint requires `acceptPermissions: true` and the SHA the UI displayed (anti-TOCTOU: prevents a race where the registry mutates between display and confirm).

### Update screen

Update flow checks whether new manifest's permissions are a superset of the granted set:
- **Subset or equal**: update proceeds; admin sees a short toast.
- **New permissions added**: dialog reappears highlighting *only* the new scopes. Update requires re-consent.
- **Permissions removed**: update proceeds; the grant is narrowed automatically.

### Revoke / uninstall

`POST /:id/uninstall` (`plugins.routes.ts:362`) extends to:
- Unload the plugin (as today).
- Remove the plugin directory.
- **New**: broadcast `plugin:revoked` over the existing WebSocket so every connected client purges its blob URL cache and reloads `/plugins/active`.
- **New**: write an audit row to a `pluginAuditLog` table: `pluginId, version, sha256, actorUserId, action: "uninstall", at: now()`. Row is retained even though the `installedPlugin` row is deleted, so forensic trail outlives the install.

### Permission inspector

Admin settings page gains a "Plugins → Permissions" view listing every active plugin with its granted scopes and last consent timestamp. Provides a fast path to "show me everything that can read all users' notes."

## 10. Migration plan

Existing installed plugins predate any of this. The migration must not brick them.

### Step 1 — schema migration (non-destructive)

Add `sha256`, `clientSha256`, `registryCommit`, `permissions`, `requiresReconsent` columns as nullable. Existing rows stay valid; new columns are `NULL`.

### Step 2 — backfill on first boot

On `discoverAndLoadPlugins` (`manager.ts:262`):
- For any installed plugin with `sha256 = NULL`, compute the current file-tree hash and write it. This is **trust-on-existing-state**: we accept whatever is on disk as the baseline. Document this clearly — anyone worried about a pre-existing compromise must reinstall.
- For `permissions = NULL`, grant a synthetic "legacy: all scopes" grant. The admin UI flags these plugins with a "legacy permissions — reinstall to scope" badge. They keep working; the admin is nudged to reinstall.

### Step 3 — feature flag rollout

`pluginIntegrity: "off" | "warn" | "enforce"`:
- `"off"` — pre-rollout / opt-out / debug. Hashes computed and stored but mismatches do not block.
- `"warn"` — default during initial rollout. Mismatches log a warning, plugin still loads. Surfaced in admin UI.
- `"enforce"` — default after one full release cycle. Mismatch → fail closed.

Same shape for permission enforcement: `pluginPermissions: "off" | "warn" | "enforce"`. Allows the ecosystem to update manifests before enforcement bites.

### Step 4 — registry-side rollout

The `azrtydxb/kryton-plugins` repo's `registry.json` is updated in two passes:
- **Pass 1**: curator computes `sha256` and `releasedAt` for every current plugin/version and commits. Server can now verify even though enforcement is `"warn"`.
- **Pass 2**: plugin authors update `manifest.json` to include `permissions`. This is a per-plugin PR. We coordinate with known authors; orphan plugins get a curator-authored conservative scope set or are delisted.

### Step 5 — flip enforcement

Once the registry is fully populated and the warning window has elapsed, change the default to `"enforce"` for both flags. Document the behavior change in the release notes.

## 11. Rollout

| Step | Visibility | Notes |
|---|---|---|
| Land the schema migration + columns | Server only | Reversible. |
| Implement hashing in `registry.service.ts`, store-only mode | Server only | No behavior change for users. |
| Add `pluginIntegrity` flag with default `"warn"` | Admin-visible | New env var `KRYTON_PLUGIN_INTEGRITY`. |
| Add admin UI surfacing hash + warning state | Admin UI | No enforcement yet. |
| Implement `pluginPermissions` schema parsing + scope-aware factory, default `"warn"` | Server + admin UI | Manifests without `permissions` continue to get full grants. |
| Implement client SRI path | Client | Falls back gracefully if `clientSha256` is null. |
| Coordinate registry update (pass 1 + 2) | External | Tracked separately. |
| Flip defaults to `"enforce"` | Behavior change | Release-noted, with a 1-flag rollback path. |

Dev mode behavior: `KRYTON_PLUGIN_INTEGRITY=warn` is the default in `NODE_ENV=development` even after the production flip, so local plugin iteration doesn't require recomputing hashes on every save.

## 12. Open questions to surface before implementation

These need answers before Phase A code is written. Each is a real design choice, not a rhetorical placeholder.

1. **Granularity of the artifact hash.** File-tree hash (canonical sorted-paths-plus-per-file-hashes manifest, then hash that) versus tarball hash. Tree hash is more transparent — humans can recompute it from a directory listing. Tarball hash is simpler to implement. Recommend tree hash; want confirmation.

2. **Who computes hashes in the registry?** Curator runs a script at release time, manual. Or CI on the registry repo computes and commits them. CI is safer (eliminates the human keystroke) but means trusting the registry-repo CI. Either is defensible; pick one and document.

3. **Per-plugin author keys vs single registry-curator key for Phase A-bis (signatures).** Even though signatures are deferred, the eventual choice influences the DB schema (do we store `signedBy`?). Recommend deferring the schema decision until signatures are actually scoped.

4. **Legacy permissions grant on backfill — opt-in or opt-out for the admin?** Option A: legacy plugins keep working until the admin explicitly migrates. Option B: legacy plugins are *disabled* on first boot after the upgrade and require re-consent. (A) is friendlier; (B) is more secure. The audit's posture suggests (B); the user impact suggests (A). Need a call.

5. **Scope grammar evolution.** When we add a new scope (e.g. `notes.attachments.write`), do existing plugins fail to install because their `manifestVersion` is too old, or do they install with the union of v1 scopes and a sane default for the new scope? Strict bumping is honest but high friction.

6. **Client SRI fallback policy.** If a client bundle hash mismatches, do we (a) skip the plugin silently, (b) skip and show an admin banner, or (c) auto-uninstall? (c) is the most paranoid but risks accidental wipe on legitimate updates that race the DB. Recommend (b) — observable, not destructive.

7. **Route registration scope: `network` vs finer-grained.** Should we have `network.public` (visible to all authenticated users) vs `network.admin` (only callable by admins)? Probably yes, but the today's plugin-mounted routes inherit the requester's auth context, so the practical effect is opaque. Worth a dedicated mini-doc.

8. **Cross-plugin storage isolation.** Today `api.storage` (`api-factory.ts:185`) namespaces by `pluginId` server-side — good. But two plugins from the same author could be designed to cooperate via shared keys. Do we explicitly forbid that, or leave it as a curator-policy issue? Recommend forbid by construction (no scope grants cross-plugin storage access ever).

9. **Performance budget for boot-time re-verification.** Re-hashing every plugin's file tree on `discoverAndLoadPlugins` adds latency proportional to plugin count and size. For the current handful of plugins this is negligible; at 50+ plugins it isn't. Should re-verification on boot be a startup option (`pluginVerifyOnBoot: true`) or always-on? Recommend always-on with a fast path (skip if `mtime` of every file matches a stored `mtime` snapshot — still detects intentional tampering, doesn't catch a sophisticated attacker who fixes mtimes, but bounds the realistic threat).

10. **What happens to in-flight requests when a plugin is revoked mid-flight?** Today there's no explicit drain; routes are removed from the plugin router and the next request 404s. Acceptable, but if we're tightening the boundary it's worth declaring the contract: "revocation is immediate; in-flight requests may complete or 502, callers must retry."

---

## Appendix A — files touched by this design

For reviewer convenience, the absolute paths the implementation will mutate or read:

- `packages/server/src/modules/plugins/services/registry.service.ts`
- `packages/server/src/modules/plugins/services/manager.ts`
- `packages/server/src/modules/plugins/services/api-factory.ts`
- `packages/server/src/modules/plugins/services/types.ts`
- `packages/server/src/modules/plugins/services/plugin-router.ts`
- `packages/server/src/modules/plugins/routes/plugins.routes.ts`
- `packages/server/src/modules/plugins/index.ts`
- `packages/server/src/db/schema/settings.ts` (new columns on `installedPlugin`; new `pluginAuditLog` table)
- `packages/client/src/plugins/PluginManager.ts`
- `packages/client/src/plugins/types.ts`

External (out of scope for the Kryton repo but blocking for end-to-end correctness):

- `azrtydxb/kryton-plugins` — `registry.json` schema extension and per-plugin manifest updates.
