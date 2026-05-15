# Content-Security-Policy allow-list — server hardening design

**Status:** draft
**Date:** 2026-05-15
**Owner:** server / security
**Tracks:** follow-up to the audit quick-wins commit (`a83dddf — fix: audit quick wins (security + maintainability) (#118)`) that left `contentSecurityPolicy: false` in `packages/server/src/plugins/security.ts:15`.

---

## 1. Goal

Replace the current `contentSecurityPolicy: false` Helmet setting with a concrete, enforced CSP that covers every CSP-sensitive surface Kryton ships today, without breaking Swagger UI, the markdown preview, dynamically imported plugin bundles, the Yjs / plugin WebSockets, or attachment delivery.

## 2. Why now

- The security audit landed in `#118` with Helmet wired up but CSP explicitly disabled, leaving a `TODO`-style comment that points at this document (`packages/server/src/plugins/security.ts:12-15`).
- Kryton already executes third-party code in the browser via the plugin client bundles loaded by `await import(/* @vite-ignore */ info.client)` in `packages/client/src/plugins/PluginManager.ts:130-132` — a CSP is the cheapest, broadest mitigation we can deploy against a misbehaving (or compromised) plugin and against stored-XSS slipping past `rehype-sanitize`.
- The markdown preview pipes user-authored content through `rehypeRaw` *then* `rehypeSanitize` (`packages/ui/src/editor/NotePreviewReact.tsx:6-7,449-450`). The sanitize schema is conservative, but it is the *only* line of defence between Markdown source and DOM. CSP gives us a second.
- We have no CSP, which means we don't even have the `default-src 'none'` baseline that would block exfil via image beacons, fonts loaded from attacker domains, etc.

## 3. Threat model

### In scope (what CSP buys us)

- **Reflected XSS** in any unauthed/authed JSON endpoint that ends up rendered by the SPA — `script-src 'self'` blocks the injected payload from executing.
- **Stored XSS via note content** — if `rehype-sanitize` ever has a bypass (it has had them — `style` URL handlers, SVG event attributes), `script-src 'self'` still blocks the injected `<script>` and `style-src 'self' 'unsafe-inline'` still blocks event-handler-style sinks like `<img onerror>` (which sanitize already strips, but defence-in-depth).
- **Plugin malice / supply-chain** — a plugin bundle can only call `connect-src` hosts on our allow-list. No exfil to `evil.com` even if a plugin tries to `fetch()` there. Tied to the (separate) plugin-integrity design doc — SRI / hashed `script-src` is out of scope here.
- **Clickjacking** — `frame-ancestors 'none'` (or `'self'`) blocks framing of the Kryton SPA into another origin.
- **Mixed-content downgrades** — `upgrade-insecure-requests` blocks HTTP subresources in HTTPS deployments.

### Out of scope (what CSP does NOT buy us)

- **DOM-based XSS** where the sink is `innerHTML` of already-trusted content. The sanitize schema (`packages/ui/src/editor/NotePreviewReact.tsx:95-117`) remains load-bearing — CSP is additive, not a replacement. Trusted Types would harden this and is listed as a follow-up.
- **CSRF** — CSP does not constrain request origins for state-changing requests; that is `SameSite` cookies + better-auth's own protections.
- **Logic flaws / authz bugs** in plugin routes (`packages/server/src/modules/plugins/services/plugin-router.ts:57`) — CSP is browser-side; server-side authz is unaffected.

## 4. Surface inventory

Every directive below is justified by a concrete callsite. If a directive does not have a citation here, it should not be in the policy.

### 4.1 Same-origin script sources

| Source | File / line | Why |
|---|---|---|
| SPA app bundle | `packages/server/src/plugins/spa.ts:25-30` (mounts `dist/` at `/`) | Vite emits `index.html` + hashed JS chunks. Always `'self'`. |
| Plugin client bundles | `packages/server/src/modules/plugins/index.ts:192-199` (mounts `<pluginsDir>` at `/plugins/`) and `packages/client/src/plugins/PluginManager.ts:130-132` (`await import(info.client)`) | Each active plugin advertises a `client` path like `/plugins/<id>/client/index.js` (`packages/server/src/modules/plugins/routes/plugins.routes.ts:99`). Dynamic `import()` is governed by `script-src`. Same origin, so `'self'` covers it. |
| Swagger UI shell | `packages/server/src/plugins/openapi.ts:253-261` (`swaggerUi` mounted at `/api/docs`, `staticCSP: true`) | `staticCSP: true` causes `@fastify/swagger-ui` to ship its own static CSP header for the `/api/docs` subtree. We must let it through OR scope our policy so it doesn't fight that one — see §6.1. |

No third-party CDN script sources. The audit confirms there is no usage of Google Fonts, jsdelivr, unpkg, etc., from the runtime client.

### 4.2 Inline scripts that exist today

| Source | File / line | Status |
|---|---|---|
| Swagger UI bootstrap | `@fastify/swagger-ui` ships an `index.html` with an inline `<script>` that boots the UI. With `staticCSP: true` (set at `packages/server/src/plugins/openapi.ts:256`), `@fastify/swagger-ui` injects its own CSP including a hash for that one block. | OK as long as we either (a) exclude `/api/docs/*` from our policy and let swagger's own header apply, or (b) merge the hash into our policy. See §6.1. |
| Application JS | None. Vite-built bundle has no inline `<script>`. | OK. |
| Note content `<script>` | Stripped by `rehype-sanitize` (`packages/ui/src/editor/NotePreviewReact.tsx:97-99` — `script`, `iframe`, `object`, `embed`, `form` removed from `tagNames`). | OK — never reaches DOM. |

Conclusion: outside `/api/docs`, we can run `script-src 'self'` with no `'unsafe-inline'`.

### 4.3 Same-origin styles + inline-style situation

| Source | File / line | Why |
|---|---|---|
| Tailwind / app CSS | Emitted by Vite as hashed `.css` under `/assets/` — same-origin, covered by `style-src 'self'`. |
| `<style>` blocks in components | `packages/client/src/components/Preview/Preview.tsx:267` (`<style>{MD_CSS}</style>`), `packages/ui/src/notes/FileTree.tsx:662` (`<style>{...}</style>`), `packages/client/src/lib/exportPdf.ts:13` (inline `<style>` in the PDF export template). | These are `<style>` *elements* with text children. Governed by `style-src` — requires `'unsafe-inline'` OR a per-render nonce / hash. React renders these fresh on each mount, so hashing is brittle. Practical answer: `style-src 'self' 'unsafe-inline'`. |
| Inline `style={{}}` attributes | Extensive use in `packages/client/src/App.tsx`, all of `packages/client/src/components/Preview/Preview.tsx` (10+ occurrences), every Layout component. | Governed by `style-src-attr` (CSP3). Until we refactor all of these to CSS classes (large undertaking), `style-src-attr 'unsafe-inline'` is required. |
| Swagger theme injection | `packages/server/src/plugins/openapi.ts:259` injects `KRYTON_SWAGGER_THEME` via Swagger UI's `theme.css` option — served as a same-origin CSS file. | `style-src 'self'`. |

The realistic style policy is `style-src 'self' 'unsafe-inline'` and `style-src-attr 'unsafe-inline'`. See §6.3 for the residual XSS risk discussion.

### 4.4 Image sources

| Source | File / line | Why |
|---|---|---|
| Attachments | `packages/server/src/modules/notes/aux-routes.ts:13,21` (`/api/attachments` prefix), `packages/server/src/modules/notes/routes/attachments.routes.ts:202` (`reply.header("Content-Type", att.mimeType)`) | Same origin → `'self'`. The whitelist of MIME types is strict (`attachments.routes.ts:28-36`): `image/png|jpeg|gif|webp|avif|heic|heif`, plus `audio/*`, `video/*`. SVG is explicitly excluded (comment at `attachments.routes.ts:23-25`). |
| Data-URI images in markdown | `rehype-raw` lets `<img src="data:...">` through; `rehype-sanitize` allows `src` (`packages/ui/src/editor/NotePreviewReact.tsx:113`). | Needs `img-src 'self' data:`. |
| Wiki-linked images | Rendered as `<img>` against same-origin attachment URLs. | `'self'`. |
| Blob URLs (export PDF) | `packages/client/src/lib/exportPdf.ts` uses `URL.createObjectURL` for the print frame. | `img-src ... blob:` so the in-memory preview frame can render. |

Final: `img-src 'self' data: blob:`.

### 4.5 Media sources (audio/video)

| Source | File / line | Why |
|---|---|---|
| Attachment audio/video | `packages/server/src/modules/notes/routes/attachments.routes.ts:36` (`ALLOWED_MIME_PREFIXES = ["audio/", "video/"]`). | Same origin → `media-src 'self' blob:` (blob for client-side recording workflows if/when they land). |

### 4.6 Font sources

No external fonts are loaded. `JetBrains Mono`, `Inter`, etc. are system-font fallbacks declared in `packages/server/src/plugins/openapi.ts:40` and `packages/ui/src/...`. If self-hosted font files are added later, they'll be served from `/assets/`. → `font-src 'self' data:` (data: for embedded WOFF if any tooling emits them).

### 4.7 Frame ancestors / frame-src / object-src

- The SPA is never expected to be framed. → `frame-ancestors 'none'`.
- The SPA does not embed third-party iframes. The export-PDF path uses an in-document iframe via `srcdoc` (`packages/client/src/lib/exportPdf.ts`). → `frame-src 'self'`.
- No `<object>`, `<embed>`, or Flash. → `object-src 'none'`.

### 4.8 WebSocket / fetch / XHR targets (`connect-src`)

| Target | File / line | Why |
|---|---|---|
| `/api/*` HTTP | All over `packages/client/src/lib/api.ts` and modules. | Same origin → `'self'`. |
| `wss://<host>/ws/yjs/:docId` | Yjs collab — `packages/server/src/modules/collab/ws/yjs.handler.ts:336` (`url: "/ws/yjs/:docId"`). Client connects via `new WebSocket(...)` in the Yjs provider. | Same origin → `'self'` + `wss:` scheme on the deployed origin. |
| `wss://<host>/ws/plugins` | Plugin lifecycle channel — `packages/server/src/modules/plugins/services/plugin-websocket.ts:18` (`url: "/ws/plugins"`); client at `packages/client/src/plugins/PluginManager.ts:52-57`. | Same origin → `'self'`. |
| `VITE_API_BASE_URL` cross-origin API | `packages/client/src/App.tsx:26` (`baseUrl: import.meta.env.VITE_API_BASE_URL ?? ""`). In dev or when the SPA is hosted on a different origin than the API, this is set to an absolute URL. | `connect-src` must include that URL at build time — see §5.2 (env-substituted policy). |
| Better-auth callbacks | `packages/server/src/plugins/auth.ts:66-250` mounts better-auth on `/api/auth/*` — same origin. | Covered by `'self'`. |
| Dev: Vite HMR `ws://localhost:5173` | `packages/client/vite.config.ts:server` proxies `/ws` to backend; HMR itself runs on Vite's own port. | Dev-only — see §5.2 dev variant. |

### 4.9 Worker / manifest / form

- **Workers**: no `new Worker()` callsites in `packages/client/src` or `packages/ui/src`. The server-side embedder worker (`embedderPlugin`) does not affect browser CSP. → `worker-src 'self' blob:` is conservative-safe (Swagger UI sometimes spawns a worker for blob downloads). |
- **Manifest**: PWA manifest is not yet shipped. → omit `manifest-src` for now; defaults to `default-src`. |
- **Form actions**: better-auth UI may post forms to `/api/auth/...` — same origin. → `form-action 'self'`. |
- **Base URI**: lock down so injected `<base href>` cannot retarget relative URLs. → `base-uri 'self'`. |

## 5. Proposed policy

### 5.1 Production directives

Concrete Helmet config (Helmet's `contentSecurityPolicy` option accepts a `directives` object — each value is an array of source expressions):

```ts
// packages/server/src/plugins/security.ts (sketch — not implemented in this PR)
contentSecurityPolicy: {
  useDefaults: false, // we enumerate every directive explicitly
  directives: {
    defaultSrc: ["'none'"],                          // deny-by-default; every directive below opts in.

    scriptSrc: [
      "'self'",                                       // SPA bundle (spa.ts:25-30) + plugin bundles (plugins/index.ts:192-199, PluginManager.ts:130-132)
    ],
    scriptSrcAttr: ["'none'"],                        // no inline event handlers anywhere — sanitize strips them.

    styleSrc: [
      "'self'",                                       // Vite-emitted CSS, Swagger theme CSS (openapi.ts:259)
      "'unsafe-inline'",                              // <style> elements in Preview.tsx:267, FileTree.tsx:662, exportPdf.ts:13
    ],
    styleSrcAttr: ["'unsafe-inline'"],                // pervasive style={{}} usage across client components — see §4.3

    imgSrc: ["'self'", "data:", "blob:"],            // attachments (attachments.routes.ts:202), data-URI images in markdown, exportPdf blob frames
    mediaSrc: ["'self'", "blob:"],                   // audio/video attachments (attachments.routes.ts:36)
    fontSrc: ["'self'", "data:"],                    // self-hosted fonts only; system stack otherwise

    connectSrc: [
      "'self'",                                       // /api/*, /ws/yjs/*, /ws/plugins on same origin
      // Plus environment-substituted entries: see §5.2.
    ],

    workerSrc: ["'self'", "blob:"],                  // future-proof for Swagger UI download blobs
    frameSrc: ["'self'"],                            // exportPdf srcdoc iframe
    frameAncestors: ["'none'"],                       // SPA is never framed
    objectSrc: ["'none'"],                            // no <object>/<embed> anywhere
    formAction: ["'self'"],                           // better-auth forms post same-origin
    baseUri: ["'self'"],                              // lock <base href>

    upgradeInsecureRequests: [],                      // empty array = directive present, no value (HTTPS-only deployments)
  },
}
```

Notes:

- `useDefaults: false` — Helmet's defaults are sensible but include things we want to be explicit about (`script-src-attr 'none'`, no `worker-src`). Better to enumerate.
- We do not use a nonce. Adding nonces means giving the Fastify request hook access to `reply.header()` for every HTML response and rewriting the SPA `index.html` per-request — see §6.4 for why this isn't worth it for the current surface.
- The Swagger UI route `/api/docs/*` is handled specially — see §6.1.

### 5.2 Dev variant

In dev (`config.NODE_ENV !== "production"`) the policy needs to loosen for Vite HMR. Vite serves the SPA from `http://localhost:5173`, opens a HMR WebSocket on the same origin, and the client proxies `/api`, `/plugins`, `/ws` back to the Fastify server on `localhost:3001` (`packages/client/vite.config.ts:server.proxy`).

Concretely:

- `connect-src` adds `ws://localhost:* http://localhost:*` (HMR + proxy).
- `script-src` may need `'unsafe-eval'` if the Vite dev runtime uses `new Function()` for HMR (verify against installed Vite version before enabling).
- `style-src` keeps `'unsafe-inline'` (already required).
- The dev policy should **also** be applied in `Content-Security-Policy-Report-Only` mode during initial rollout (see §7) — that way violations are visible in DevTools without breaking dev.

Encode it as a separate branch of the same Helmet config keyed on `config.NODE_ENV` inside `securityPlugin`. If the additional env-substituted `connect-src` host for `VITE_API_BASE_URL` is set, append it to the prod policy's `connect-src` too (the build is currently per-deployment, so a single env var read at server start is fine).

### 5.3 Where the policy is enforced

- Helmet is registered at `packages/server/src/plugins/security.ts:11`. Replace `contentSecurityPolicy: false` with the directive object above.
- For the `/api/docs/*` subtree, do one of:
  - **(preferred)** Register Helmet with `contentSecurityPolicy` *globally* but install a Fastify `onSend` hook scoped to `/api/docs` that overrides the CSP header with Swagger UI's own (whatever `staticCSP: true` would emit). This keeps the two policies independent.
  - **(alternative)** Compute the SHA-256 hash of the swagger-ui inline `<script>` once at boot and add it to `script-src` globally. Brittle to swagger-ui version upgrades.

The first option is preferred and is what this design assumes.

## 6. Hard problems to flag before implementation

### 6.1 Swagger UI's inline assumptions

`@fastify/swagger-ui` with `staticCSP: true` emits its own `Content-Security-Policy` header on `/api/docs` responses. That header includes a hash for the bootstrap inline `<script>` and `'unsafe-inline'` for the inline `<style>` blocks the UI ships.

If Helmet's global CSP header runs *after* swagger's, ours wins and the UI breaks (the inline script's hash is no longer allowed). Options:

1. Skip Helmet's CSP on `/api/docs/*` via an `onSend` hook that deletes the header before it goes out, letting swagger's own header through. **Cleanest.**
2. Replace `staticCSP: true` with `staticCSP: false` and bake the swagger requirements into our global policy. Brittle — every swagger-ui version bump risks a new inline script.
3. Disable swagger UI in production deployments. Probably already true for most operators (`config.OPENAPI_ENABLED` gate at `packages/server/src/plugins/openapi.ts:228`), but operators who *do* enable it must not get a broken UI.

Decision required: **route-scoped suppression**, implementation in the rollout PR.

### 6.2 Plugin `script-src` — strict `'self'` only, or SRI / hashes?

Today, any active plugin's `client/index.js` is allowed by `script-src 'self'`. That means a compromised plugin file on disk (or a manifest-spoofing attack against the plugins directory) gets executed without integrity check.

The proper answer is **Subresource Integrity** (SRI) — the active-plugins API would advertise an `integrity:` hash alongside each `client` URL, and `PluginManager.ts:130-132` would refuse to import a script whose hash mismatches. CSP can enforce that via `require-sri-for script` (deprecated; not universally supported) or by switching to hashed `script-src` entries.

**Tied to a separate plugin-integrity design doc.** This CSP rollout does not block on it — `'self'` is strictly better than nothing.

### 6.3 `rehype-raw` + `unsafe-inline` style: is the sanitize schema strong enough?

The flow is:

1. `remarkParse` → MDAST
2. `remarkGfm`, `remarkWikiLink` extensions
3. `rehypeRaw` — re-parses any raw HTML embedded in the markdown into the HAST tree. **This is where attacker-controlled HTML enters the tree.**
4. `rehypeSanitize` with `SANITIZE_SCHEMA` (`packages/ui/src/editor/NotePreviewReact.tsx:95-117`).

The sanitize schema removes `script`, `iframe`, `object`, `embed`, `form` (`NotePreviewReact.tsx:97-99`) and inherits the rest from `defaultSchema`. The schema does *not* explicitly allow `style` as an attribute on any tag — so `<div style="background:url(javascript:...)">` is stripped at the attribute level before it reaches the DOM.

Risk analysis with our proposed CSP:

- `script-src 'self'` blocks `<script>` execution even if sanitize misses one. ✅
- `style-src 'unsafe-inline'` allows `<style>` elements *and* the contents of `style=""` attributes — but the sanitize schema strips `style` attributes (defaultSchema does not include it on most tags). So `style-src 'unsafe-inline'` is mostly there for *our own* `<style>` blocks in `Preview.tsx`, not for user content. ✅
- `style-src-attr 'unsafe-inline'` is required because *our app code* uses `style={{}}`. User-supplied `style=""` attributes would be sanitized away first. ✅
- `img-src 'self' data:` — `data:` allows bytes-as-image, which is fine. The bigger worry is `<img src="x" onerror="...">`; sanitize strips `onerror` (defaultSchema does not allow it). ✅

Verdict: schema is strong enough *given* CSP as the second layer. If we ever loosen the schema (e.g. to allow `style` attributes for rich-text imports), we must reconsider.

### 6.4 Nonce vs hash vs `'unsafe-inline'` for Swagger

We're choosing `'unsafe-inline'` for `style-src` (broad use of inline styles in our own client). For `script-src` we want strict `'self'`.

Nonces in Helmet require per-request middleware that mutates the response. Fastify supports this via `app.addHook("onRequest", ...)`, but we then have to inject the nonce into `index.html` at serve time — which means the SPA can no longer be served as a static asset by `@fastify/static` at `packages/server/src/plugins/spa.ts:25-30`. Cost is real (custom HTML transform on every navigation); benefit is small (we have *no* inline scripts in our app bundle).

**Decision: no nonces.** Strict `script-src 'self'` is sufficient given the bundle has no inline JS, and Swagger's inline scripts are isolated via the route-scoped suppression in §6.1.

## 7. Rollout plan

Two-phase rollout. The first phase is observational only — zero risk of breakage.

### Phase 1 — Report-Only

- Set the header as `Content-Security-Policy-Report-Only` (Helmet supports `reportOnly: true`).
- Add a `report-to` (or `report-uri` for older browsers) endpoint at `/api/csp-report` that logs violation reports to the existing logger.
- Ship to production. Monitor logs for ≥ a meaningful sample of authenticated sessions and ≥ one full plugin lifecycle (install / activate / uninstall) per actively used plugin.
- Triage every violation:
  - **App bug** → fix the violation (e.g. remove an inline event handler we didn't know existed).
  - **Policy gap** → add to allow-list with a citation, update this doc.
- Exit criterion: zero unexpected violations for one full release cycle.

### Phase 2 — Enforce

- Flip `reportOnly: false`. Same allow-list, same `report-to` endpoint (still useful for catching regressions).
- Announce in CHANGELOG. Operators with non-default deployments (`VITE_API_BASE_URL` pointing to a third-party host, embedded iframes of Kryton, etc.) need to know.

### Test plan

- Unit: snapshot the rendered CSP header against a golden string in `packages/server/src/__tests__/security.test.ts`.
- Integration: a Fastify `app.inject()` test that hits `/api/docs` and asserts the *swagger* CSP is what's returned (not ours).
- Manual: drive the SPA through one full session — open a note with markdown HTML, install a plugin, exercise the dataview block, export to PDF, open `/api/docs`. Zero CSP violations in DevTools console.

## 8. Out of scope

Explicitly deferred:

- **Subresource Integrity for plugin bundles** — tracked separately as the plugin-integrity design.
- **Trusted Types** (`require-trusted-types-for 'script'`) — requires a sweep of every DOM sink and a polyfill story. Worth doing, large effort.
- **Per-request nonces** — see §6.4 decision.
- **`report-to` group / Reporting API v2** — Phase 1 uses the legacy `report-uri` for browser compatibility. Migrate later.
- **CSP for the `prototype/` static demos** — those are not served by the Fastify app in production. Out of scope.
- **Refactoring `style={{}}` usage to CSS classes** to drop `style-src-attr 'unsafe-inline'`. Large UI sweep; nice-to-have.
- **Removing `'unsafe-inline'` from `style-src`** by extracting the three `<style>` blocks (`Preview.tsx:267`, `FileTree.tsx:662`, `exportPdf.ts:13`) to static CSS. Possible but requires moving the dynamic theme tokens out of the JS string. Tracked separately.

---

## Appendix A — Final directive matrix

| Directive | Production value | Justification |
|---|---|---|
| `default-src` | `'none'` | Deny-by-default. |
| `script-src` | `'self'` | SPA bundle + plugin bundles, all same-origin. |
| `script-src-attr` | `'none'` | No inline event handlers in app or sanitized content. |
| `style-src` | `'self' 'unsafe-inline'` | `<style>` elements in Preview/FileTree/exportPdf. |
| `style-src-attr` | `'unsafe-inline'` | Pervasive `style={{}}` in components. |
| `img-src` | `'self' data: blob:` | Attachments, data-URI images, exportPdf blob frames. |
| `media-src` | `'self' blob:` | Audio/video attachments. |
| `font-src` | `'self' data:` | Self-hosted fonts if any; system stack otherwise. |
| `connect-src` | `'self'` + env-substituted `VITE_API_BASE_URL` | `/api/*`, `/ws/yjs/*`, `/ws/plugins`. |
| `worker-src` | `'self' blob:` | Future-proof; Swagger downloads. |
| `frame-src` | `'self'` | exportPdf iframe. |
| `frame-ancestors` | `'none'` | SPA never framed. |
| `object-src` | `'none'` | No `<object>`/`<embed>`. |
| `form-action` | `'self'` | better-auth same-origin posts. |
| `base-uri` | `'self'` | Lock `<base href>`. |
| `upgrade-insecure-requests` | (present) | HTTPS-only deployments. |

Route-scoped exception: `/api/docs/*` is excluded — its CSP is provided by `@fastify/swagger-ui` via `staticCSP: true` (`packages/server/src/plugins/openapi.ts:256`).

## Appendix B — Files touched by the implementation PR

(Not this PR — listed for completeness so the follow-up has a checklist.)

- `packages/server/src/plugins/security.ts` — replace `contentSecurityPolicy: false` with the directive object; add the dev / prod branch.
- `packages/server/src/plugins/openapi.ts` — add the `onSend` hook (or scoped Helmet override) so Swagger's CSP wins on `/api/docs`.
- `packages/server/src/modules/platform/` — new `POST /api/csp-report` route that logs violation reports.
- `packages/server/src/__tests__/security.test.ts` — golden header snapshot tests, dev-vs-prod branch test, swagger override test.
- `CHANGELOG.md` — Phase 2 entry (operator-facing).
