# Docs Site — Design

**Date:** 2026-05-20
**Scope:** `kryton/site/` (new), `kryton/.github/workflows/pages.yml` (new), `kryton/docs/` (consumed, not moved)

## Goal

Ship a GitHub Pages site at `https://azrtydxb.github.io/kryton/` that:

1. Visually matches the WordPress site (`kryton-wp/theme/kryton/`) so docs and marketing read as one product.
2. Has two clearly-tiered IA — a non-technical *Get Started → Use* lane up front, an *Advanced* lane behind it for people who self-host, build plugins, or call the API.
3. Auto-generates the reference layer (REST from OpenAPI, plugin TypeScript surface from `.d.ts`) so it cannot drift from the code it documents.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Astro Starlight as the SSG | Cleanest control over CSS variables → easiest to replicate WP "quiet-futurism" tokens; built-in search, a11y, dark mode; lean output for GH Pages. |
| D2 | Source at `kryton/site/`, deploy from `master` via Pages workflow | Same-repo edits, docs ship with code. Output goes to GH Pages via Actions, not committed back to repo. |
| D3 | API docs auto-generated | REST via Redocly Reference embedding `kryton/packages/server/openapi.json`; plugin API via TypeDoc against `kryton-plugins/types/client.d.ts` and `kryton/packages/server/src/plugins/types.ts`. Both produce MDX consumed by Starlight. |
| D4 | Design tokens imported as raw CSS, not via the WP build | Copy the oklch palette + font-family declarations from `kryton-wp/theme/kryton/theme.json` into `site/src/styles/tokens.css`. Static reuse keeps the docs site independent of WP's PHP/Gutenberg lifecycle. |
| D5 | Branding assets reused from `kryton/logos/` (canonical graph-glyph) | Same SVGs we just standardised across repos. |
| D6 | No version routing in v1 | Single "current" docs only. If we later cut a v5, add Starlight's versioning then. |

## Audience tiers and IA

Three top-level sections. The sidebar should make the lanes obvious — *Get started* and *Use* never bury beneath *Advanced*.

```
/                                # landing
/start/                          # Get Started (non-technical)
  /install/docker/               # docker compose up
  /install/desktop-helper/       # one-liner via npx (server) — defers to Docker until a native installer exists
  /connect-ai/                   # npx @azrtydxb/kryton-init copy-paste, screenshots
  /first-notes/                  # write your first note, link, tag, daily note

/use/                            # Use (non-technical, feature walkthroughs)
  /editor/                       # split / preview, formatting toolbar, slash commands
  /linking-and-graph/            # wiki-links, backlinks, graph view
  /search-and-tags/              # full-text search, tag browser
  /sharing/                      # share dialog, access requests
  /mobile/                       # install the app, pairing
  /plugins/                      # browse + enable plugins from the admin panel
  /ai-agents/                    # how AI agents see your notes (non-tech overview)

/advanced/                       # Advanced (technical, deep)
  /deployment/
    /docker-compose/             # production compose, env, volumes, reverse proxy
    /helm/                       # full values, ingress, ExternalSecrets
    /operator/                   # CRDs, backups, multi-instance
    /free-tier-self-host/        # opinionated path to a free Pages-style self-host (Fly free tier, Hetzner CX11, Tailscale, etc.)
    /backups-restore/
    /upgrades-and-migrations/
  /security/
    /auth-providers/             # passkeys, OAuth, 2FA
    /api-keys-and-mcp/           # full key model, scopes, secret scanning
    /reverse-proxy-and-tls/
  /api/
    /rest/                       # Redocly-rendered OpenAPI reference
    /mcp-tools/                  # auto-generated list of 33 MCP tools + plugin tools
    /yjs-websocket/              # /ws/yjs/:docId protocol notes
  /plugins/
    /overview/                   # what a plugin is, lifecycle, where files live
    /quickstart/                 # scaffold + ship a hello-world plugin
    /client-api/                 # auto-generated from kryton-plugins/types/client.d.ts (TypeDoc)
    /server-api/                 # auto-generated from packages/server/src/plugins/types.ts (TypeDoc)
    /ui-slots/                   # sidebar, statusbar, editor-toolbar, topbar
    /code-fence-renderers/       # interactive flag, range vs rawRange, kanban as canonical example
    /testing-and-publishing/     # vitest, registry PR flow
  /contributing/
    /dev-setup/
    /commit-conventions/
    /release-process/
  /reference/
    /env-vars/                   # full table; superset of README's
    /configuration/              # config schema dump
    /cli/                        # kryton-init + kryton-mcp reference (mirrors docs/CLI.md)
    /changelog/                  # pulls from CHANGELOG.md
```

The landing page has three large cards (Get Started / Use / Advanced) and a small "I'm an AI agent" link at the bottom that goes straight to `/advanced/api/mcp-tools/`.

## Theming approach

Astro Starlight's theming is CSS-variable-driven. We override its built-in variables in `site/src/styles/custom.css` so that:

- Surfaces (`--sl-color-bg`, `--sl-color-bg-nav`, `--sl-color-bg-sidebar`) map to the WP `--bg`, `--bg-1`, `--bg-2`
- Text (`--sl-color-text`, `--sl-color-text-accent`) maps to `--fg`, `--accent`
- Links (`--sl-color-link`) maps to `--link`
- Body font → Inter (Google Fonts self-hosted), code font → JetBrains Mono
- Layout max width → 1200px (matches WP wideSize)
- Borders / dividers use `--line` from WP

Light/dark: WP runs dark-first. We do the same — set Starlight's default to dark, but keep the light variant available. Light palette tokens come from the matching `[data-theme="light"]` block in `kryton/packages/client/src/styles/tokens.css` so the app and the docs and the WP site all flip the same way.

Sidebar logo: `/site/public/logo.svg` is a copy of `kryton/logos/kryton_logo.svg` (the canonical graph-glyph wordmark). Favicon: `kryton/logos/kryton_icon.svg`.

Body copy gets the WP body line-height (`1.55`) and accent underline-offset for links so paragraphs feel the same.

## Auto-generated content pipelines

Three generators, all run in CI before the Astro build:

| Output | Source | Tool | Output dir |
|---|---|---|---|
| REST API reference | `kryton/packages/server/openapi.json` (the server's existing Swagger output) | `@redocly/cli build-docs` | `site/src/pages/advanced/api/rest.html` (embedded via Starlight passthrough) |
| Plugin client API | `kryton-plugins/types/client.d.ts` | `typedoc --plugin typedoc-plugin-markdown` | `site/src/content/docs/advanced/plugins/client-api/` |
| Plugin server API | `kryton/packages/server/src/plugins/types.ts` (subset of public exports) | TypeDoc same as above | `site/src/content/docs/advanced/plugins/server-api/` |
| MCP tool list | `kryton/packages/server/src/modules/agents/mcp/tools.ts` (parse the `getToolDefinitions()` array) | Tiny Node script | `site/src/content/docs/advanced/api/mcp-tools.md` |

Generators run as a single `npm run prebuild` step in `site/package.json`. The CI workflow runs that, then `npm run build`, then deploys.

For `kryton-plugins/types/client.d.ts` access: the site repo (kryton) needs that file. Easiest is a tiny CI step that does `git clone --depth=1 https://github.com/azrtydxb/kryton-plugins.git /tmp/kryton-plugins` and points TypeDoc at the result. No git submodule.

## Build + deploy pipeline

`.github/workflows/pages.yml`:

```
on:
  push:
    branches: [master]
    paths: [site/**, docs/**, packages/server/openapi.json, packages/server/src/modules/agents/mcp/tools.ts, packages/server/src/plugins/types.ts, .github/workflows/pages.yml]
  workflow_dispatch:

jobs:
  build:
    steps:
      - checkout (with kryton-plugins co-clone in /tmp)
      - setup-node 24
      - cd site && npm ci
      - npm run prebuild   # runs the three generators
      - npm run build
      - upload-pages-artifact (dist/)
  deploy:
    permissions: pages: write, id-token: write
    needs: build
    steps:
      - deploy-pages
```

Pages source set to "GitHub Actions" via API or one-time UI toggle.

## Content sourcing

Most pages are new prose, but several pull from existing files to stay DRY:

| Page | Source |
|---|---|
| `/advanced/contributing/release-process/` | wraps `kryton/.github/workflows/release.yml` reality + `CONTRIBUTING.md` |
| `/advanced/reference/changelog/` | `kryton/CHANGELOG.md` (rendered through Starlight) |
| `/advanced/reference/cli/` | `kryton/docs/CLI.md` (rendered through Starlight) |
| `/advanced/deployment/helm/` | extends `kryton/docs/HELM.md` |
| `/advanced/deployment/operator/` | extends `kryton/docs/OPERATOR.md` |
| `/advanced/api/mcp-tools/` | auto-generated (see above) |
| `/advanced/plugins/*` | mostly auto-generated; narrative wrappers reference the auto-gen output |

For the inherited `.md` files we use Astro Starlight's ability to point a content collection entry at a relative path so we don't have to maintain two copies. Specifically: `site/src/content/docs/advanced/reference/cli.mdx` does `import content from '../../../../../docs/CLI.md?raw'` and renders it. Verified pattern, no copy-paste.

## Out of scope

- Versioned docs (no v1 need; revisit when we cut a major)
- i18n
- Custom search backend (use Starlight's built-in pagefind, which is good enough)
- Custom blog / changelog feed beyond rendering `CHANGELOG.md`
- Comments / community widgets
- Analytics (defer until the site is live and we know what to measure)
- Touching the WordPress site or its theme — this site stands alone and visually echoes WP

## Open questions

- **OQ1** (Phase 1 / Phase 3): Domain. The deployed URL will be `https://azrtydxb.github.io/kryton/`. Do you want a custom domain (`docs.kryton.ai`)? If yes, you'll need to add a CNAME and a DNS record; flag at deploy time.
- **OQ2** (Phase 4): How "free-tier-self-host" should we be? E.g. opinionated walkthrough of Fly.io free tier, Hetzner cx22, Tailscale-only access. Default if no answer by Phase 4: write one opinionated path (Hetzner cx22 + Caddy + Tailscale) plus a "see the Helm guide for everything else" pointer, not an exhaustive comparison.

## Non-goals

- Replacing the WP marketing site
- Replacing the in-app `/api/docs` Swagger UI (that's still the runtime API explorer)
- Doc translations
- Marketing copy / case studies
