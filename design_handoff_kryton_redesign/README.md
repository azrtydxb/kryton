# Handoff: Kryton — Notes app redesign

## Overview

This is a redesign of **Kryton**, a self-hosted personal-knowledge / notes app (Obsidian-style: markdown notes, wikilinks, tags, graph view) with a **terminal-developer × cyber-AI** aesthetic. The redesign reframes the app around three things:

1. A keyboard-first, monospace-flavoured interface that feels like a developer tool, not a consumer note-taker.
2. Subtle ambient AI presence (MCP indicator, agent avatars, AI-search hint in the command palette) without leaning on AI-slop tropes.
3. A three-pane working surface (sidebar · editor · graph rail) with strict visual rhythm — all bottom rails aligned at 28px height, mono labels in lowercase or `UPPERCASE`, dashed-underline links, oklch palette.

The handoff covers every screen, the tweak/preference system, the design tokens, and the interaction model.

## About the Design Files

The files in `prototype/` are **design references created in HTML + React (in-browser Babel)** — they are prototypes showing intended look and behaviour, not production code to copy directly.

Your task is to **recreate these designs in Kryton's existing codebase environment** using its established patterns and libraries (component library, styling system, routing, state management). If Kryton has no codebase yet, choose the most appropriate framework for a self-hosted notes app (React + Vite + TypeScript is a sensible default) and implement the designs there. Translate the inline-style React in the prototype into idiomatic components in your stack — do not ship the prototype's `Kryton.html` as-is.

## Fidelity

**High-fidelity (hifi).** All colours, typography, spacing, border radii, icon sizes, and interaction states are final. Recreate pixel-perfectly using your codebase's libraries. Where the prototype uses inline styles, lift the values verbatim.

The user has confirmed **`compact` density as the default** for the production build (the prototype defaults to `cozy` for screenshots; switch the default to `compact` when implementing).

## Files in this bundle

```
prototype/
  Kryton.html                # Entry HTML — loads React, Babel, all .jsx
  tweaks-panel.jsx           # Starter component for the tweaks UI (do NOT port — see below)
  app/
    main.jsx                 # App shell, routing, tweak state, keyboard shortcuts
    sidebar.jsx              # Left rail: brand, search, sections, MCP/agent footer
    editor.jsx               # Markdown editor with edit/split/preview, backlinks, meta strip
    graph.jsx                # Graph rail (Local/Global), legend, hover card
    palette.jsx              # ⌘K command palette
    screens.jsx              # AllNotesView, LoginScreen
    data.jsx                 # Mock notes, tags, graph nodes/edges
    icons.jsx                # All inline SVG icons (I.* namespace)
  styles/
    tokens.css               # Design tokens — themes, accents, density, type
  ref/
    kryton_icon.svg          # Logo glyph
    kryton_logo.svg          # Wordmark
```

## Screens / Views

### 1. Editor (default route)

**Purpose** — primary working surface. User is reading or writing a markdown note.

**Layout** — three-column CSS grid: `260px sidebar | 1fr editor | 340px graph rail`. The sidebar can collapse (⌘B). The graph rail can be hidden via tweaks. All three columns share the same 28px-height bottom rail so the baselines align perfectly across the row.

**Components**
- **TopBar** (height 40px, border-bottom 1px `var(--line)`)
  - Left: sidebar-toggle icon button, breadcrumb "vault / Daily / 2025-11-09" in mono `var(--fs-sm)` `var(--fg-2)`.
  - Right: theme toggle, `⌘K` palette opener button (mono, with `kbd` chip).
- **Sidebar** — see "Sidebar" below.
- **Editor pane**
  - **Tab strip** (height 32px) — open notes as tabs. Active tab has a 2px-bottom-border in `var(--accent)` and a saved-status pulse dot.
  - **Mode pills** — segmented control (Edit / Split / Preview), mono labels, `var(--accent-soft)` background on active.
  - **Editor body**
    - Edit mode: monospace text area with line numbers (10.5px mono, `var(--fg-4)`), 1.7 line-height, padding 24px 32px.
    - Preview mode: rendered markdown — see "Markdown rendering" below.
    - Split mode: 50/50 vertical split with a 1px `var(--line)` divider.
  - **Backlinks rail** (only in preview/split, right side of body) — heading `// linked from` in mono uppercase `var(--fg-4)`, then a list of linking note titles + paths.
  - **EditorMeta** (height 28px, border-top 1px `var(--line)`, background `var(--bg-1)`) — mono 11px row showing: `wc 1,247 · 8 min · md · last saved 2m ago` separated by middle dots in `var(--fg-4)`.
- **GraphPanel** — see "Graph" below.

### 2. All notes view

**Purpose** — browse the full vault.

**Layout** — replaces the editor pane (sidebar and graph rail stay). Header strip (height 38px) has: inbox icon, "all notes" title, count, **list/grid view toggle**, sort dropdown (`updated` / `title`).

**List view** — rows of `20px icon | title+path | tags | wordcount | updated` separated by `var(--line)` borders. Hover background `var(--bg-hover)`. Star icon for favourited notes.

**Grid view** — `repeat(auto-fill, minmax(220px, 1fr))` cards. Each card: 14px padding, 8px radius, 1px border `var(--line)`, hover border `var(--accent)`. Shows: icon+path · title · tag chips · `Nw · updated <date>`.

### 3. Graph fullscreen

**Purpose** — explore the entire knowledge graph.

**Layout** — replaces the editor pane and hides the side graph rail. Same `<GraphPanel>` component with `fullscreen` prop and `mode="global"`.

**Components**
- **Header strip** (height 38px) — graph icon, "graph" title, **Local / Global** mode toggle (segmented), zoom controls.
- **SVG canvas** — force-directed layout. Active node larger, accented; off-set (non-neighbour) nodes ghosted to 30% opacity. Edges in `var(--line-strong)`. Hover any node → info card appears (title, path, tag count, "open" CTA).
- **Legend strip** (height 28px, border-top, mono 11px) — legend dots + labels: "● this note   ● linked   ○ tagged   — backlinks".

### 4. Login

**Purpose** — first-touch authentication.

**Layout** — centred 380px-wide card on a `bg-grid` background with a soft accent radial-gradient orb behind. Brand mark + "kryton" wordmark above the card.

**Card** — 28px padding, 12px radius, `var(--bg-1)` background, 1px `var(--line)` border, `--shadow-md`.
- Mono uppercase eyebrow: `// authenticate` (or `// register`).
- Display heading "Welcome back" / "Create your account" — `var(--font-display)` 22px.
- Sign-in / Register tab strip (mono uppercase, accent underline on active).
- **Field** component — mono lowercase label above input. Input: 10px 12px padding, `var(--bg-input)`, 1px `var(--line)`, focus → `var(--accent)` border + 3px `var(--accent-soft)` ring, mono 13px text.
- Primary button — `var(--accent)` background, `var(--accent-fg)` text, mono uppercase 12.5px, `letter-spacing: 0.04em`.
- "OR" divider with thin lines.
- Secondary "continue with passkey" button — `var(--bg-2)` background, `var(--line)` border.
- Footer: dashed-top-border note "self-hosted · your notes, your server".
- **Status row** (under card) — `● server online` (pulsing dot in `var(--accent-good)`) and version string `v0.4.2`.

### 5. Empty state (no note open)

Re-themed grid backdrop with a keyboard-shortcut grid in the centre — `⌘N` new note, `⌘K` palette, `⌘P` quick-open, `⌘G` graph, etc. Each row: kbd chip + mono label.

### 6. Command palette (⌘K)

**Purpose** — keyboard-first navigation and AI search.

**Layout** — centred modal, 560px wide, 12px radius, `--shadow-lg`, opens with a backdrop dim.

**Components**
- **Search input** — large (16px), mono, no border, with a leading `>` mono prompt glyph in `var(--accent)`. Placeholder "search or type a command…".
- **AI hint** — directly under the input, small mono row "✦ AI search ready · press ↵ to ask Claude" in `var(--fg-3)`, accent sparkle icon.
- **Results** — sectioned (Commands · Notes · Tags). Each row: 18px icon, label, kbd hint on the right. Selected row has `var(--accent-soft)` background.

## Sidebar (specifics)

Width **260px**, background `var(--bg-1)`, border-right 1px `var(--line)`. Vertical sections, top-to-bottom:

1. **Brand row** (height 40px) — graph-glyph mark + "kryton" wordmark mono 14px. No giant logo.
2. **Search input** (32px) — mono placeholder "search…", ⌘K hint chip on the right.
3. **Quick-actions row** — "+ new note", "+ new folder" — mono 11.5px, dashed underline on hover.
4. **Sections** with mono uppercase headings (`var(--fg-4)`, letter-spacing 0.1em):
   - **Favorites** — list of pinned notes
   - **Files** — folder tree, expandable
   - **Tags** — tag chips, count on the right
5. **AgentsFooter** (height **28px**, border-top 1px `var(--line)`, background `var(--bg-1)`)
   - `MCP` pill in `var(--accent-soft)` with pulsing dot
   - "2 agents" mono label
   - Agent avatars (16px circles, `var(--bg-2)`, 1px `var(--line)`) — single-character glyphs

## Markdown rendering

In the editor preview pane:
- `h1` — display font, 28px, weight 600, letter-spacing -0.4
- `h2` — display font, 18px, margin `28px 0 10px`, letter-spacing -0.2
- Body — sans, 14.5px, line-height 1.7, `var(--fg-1)`
- Wikilinks — `var(--link)` colour, `text-decoration: underline; text-decoration-style: dashed; text-underline-offset: 3px`
- Inline code — mono 0.88em, `background: var(--code-bg)`, `color: var(--code-fg)`, `padding: 1px 6px`, `border-radius: 4px`
- Code blocks — mono, `var(--bg-2)` background, 12px padding, 6px radius, language label in mono uppercase top-right
- Blockquotes — left border 2px `var(--accent)`, padding-left 14px, italic `var(--fg-2)`

## Tweaks system

The prototype exposes user preferences via a "Tweaks" panel (a starter component). **Do NOT port the floating Tweaks panel into production** — it is a design-review tool. Instead, surface these as **app preferences** in a Settings screen / dialog (use your codebase's existing settings UI).

The set of preferences:

| Key | Type | Default (production) | Options |
|---|---|---|---|
| `theme` | radio | `dark` | `dark` · `light` |
| `accent` | swatch | `violet` | `violet` · `cyan` · `green` · `amber` · `rose` |
| `fontPair` | select | `jetbrains-inter` | `jetbrains-inter` · `ibm-inter` · `jetbrains-serif` · `mono-only` |
| `density` | radio | **`compact`** | `compact` · `cozy` · `comfy` |
| `layout` | radio | `split` | `edit` · `split` · `preview` |
| `graphPosition` | radio | `right` | `right` · `hidden` |

Each is applied as a `data-*` attribute on `<html>` (`data-theme`, `data-accent`, `data-density`) and the font-pair sets CSS custom properties `--font-mono` / `--font-sans` / `--font-display`. See `app/main.jsx` for the exact wiring.

## Interactions & Behaviour

### Keyboard shortcuts (global)

- `⌘K` / `⌘P` — open command palette
- `⌘B` — toggle sidebar
- `⌘N` — open All Notes
- `⌘G` — toggle Graph fullscreen

### Saved-status pulse

While the user types, the editor tab shows a small accent dot. After 1.5s of idle the dot fades and EditorMeta updates `last saved <relative>`.

### Graph hover

On hover of any graph node, an info card fades in (200ms) anchored to the node's top-right with title, path, tag count, and an "open" link. Clicking opens the note.

### Tab activation, sidebar item activation

Active state — `var(--accent-soft)` background + `var(--accent)` foreground for icons. No left-border accents (a slop trope to avoid).

### Hover states

- Sidebar rows — `var(--bg-hover)`
- All-notes list rows — `var(--bg-hover)`
- All-notes grid cards — border colour swaps to `var(--accent)`
- Buttons — slight darkening via `var(--bg-hover)` overlay; never with a transform/scale.

## State Management

The prototype uses local `useState` only. For production, use your codebase's state library (Zustand, Redux Toolkit, Pinia, etc.). Required state slices:

- **Auth** — `authed: boolean`, current user.
- **Vault** — notes (id, title, path, body, tags, links[], backlinks[], updated, words, starred), folders.
- **UI** — `activeNoteId`, `view: 'note' | 'all' | 'graph'`, `editorMode: 'edit' | 'split' | 'preview'`, `graphMode: 'local' | 'global'`, `paletteOpen`, `sidebarOpen`.
- **Preferences** — the tweak keys above (persist to localStorage and/or user profile on the server).

Data fetching: notes load from the user's self-hosted Kryton server. Use SWR / React Query semantics — stale-while-revalidate on the active note, optimistic updates on edits, debounced autosave (1.5s after last keystroke).

## Design Tokens

All values live in `prototype/styles/tokens.css`. Lift this file into your project and adapt to your styling system (CSS modules / Tailwind theme / styled-components theme).

### Type

- `--font-mono`: `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`
- `--font-sans`: `'Inter', ui-sans-serif, system-ui, sans-serif`
- `--font-display`: `'JetBrains Mono'` (or `'Instrument Serif'` in the serif font-pair)

Sizes — `--fs-xs: 11px`, `--fs-sm: 12px`, `--fs-base: 13px`, `--fs-md: 14px`, `--fs-lg: 16px`, `--fs-xl: 20px`, `--fs-2xl: 28px`, `--fs-3xl: 40px`.

### Radii

`--radius-xs: 3px`, `--radius-sm: 5px`, `--radius-md: 8px`, `--radius-lg: 12px`.

### Density rows

`--row-compact: 24px`, `--row-cozy: 28px`, `--row-comfy: 32px`. **Default to `compact` (24px row)**.

### Colour palette (oklch)

**Dark theme** (default)
- `--bg`: `oklch(0.18 0.012 280)`
- `--bg-1`: `oklch(0.205 0.014 280)` — sidebar, footers, cards
- `--bg-2`: `oklch(0.235 0.016 282)` — agent avatars, code blocks
- `--bg-3`: `oklch(0.27 0.018 282)`
- `--bg-input`: `oklch(0.225 0.014 282)`
- `--bg-hover`: `oklch(0.255 0.018 285 / 0.6)`
- `--bg-active`: `oklch(0.32 0.06 285 / 0.35)`
- `--line`: `oklch(0.32 0.012 280 / 0.6)`
- `--line-strong`: `oklch(0.4 0.014 280 / 0.7)`
- `--fg` → `--fg-4`: `oklch(0.96 / 0.85 / 0.65 / 0.5 / 0.4 0.005-0.012 280)`
- `--accent` (violet): `oklch(0.72 0.18 295)`; `--accent-soft`: `… / 0.18`
- `--accent-2` (cyan): `oklch(0.78 0.14 200)`
- `--accent-warn` (amber): `oklch(0.82 0.16 75)`
- `--accent-good` (green): `oklch(0.78 0.16 155)`
- `--accent-danger` (rose): `oklch(0.7 0.2 25)`
- `--link`: `oklch(0.78 0.16 285)`
- `--code-bg` / `--code-fg`: rose-ish tinted set (see tokens.css)
- `--selection`: `oklch(0.72 0.18 295 / 0.35)`
- `--shadow-md`: `0 4px 24px -6px oklch(0 0 0 / 0.5), 0 1px 2px oklch(0 0 0 / 0.4)`
- `--shadow-lg`: `0 12px 48px -12px oklch(0 0 0 / 0.6)`
- `--grid`: `oklch(0.32 0.012 280 / 0.18)` — used by `.bg-grid`

**Light theme** — same scale, different lightnesses. Full values in `tokens.css`.

**Accent variants** (violet, cyan, green, amber, rose) override `--accent`, `--link`, `--selection`, `--accent-soft` for both dark and light themes. See the `[data-accent="…"]` rules.

### Reusable bits

- `.mono` — applies `var(--font-mono)` + opentype features `ss01, cv02, cv11`.
- `.kbd` — keyboard chip: mono 10.5px, 2px 5px padding, `var(--bg-2)` background, 1px `var(--line)` border (border-bottom 2px), `var(--fg-2)` text.
- `.dot` / `.dot.pulse` — 6px accent dot with a 3px `var(--accent-soft)` halo; `.pulse` animates opacity 1↔0.45 over 2.4s.
- `.bg-grid` — repeating 32px grid using `var(--grid)`.

## Assets

- `ref/kryton_icon.svg` — the graph-glyph logomark (3 connected nodes).
- `ref/kryton_logo.svg` — full wordmark.

These are the only brand assets. All UI iconography is inline SVG defined in `app/icons.jsx` under the `I.*` namespace (I.FileText, I.StarOn, I.Chevron, I.Logo, I.Sparkle, I.Inbox, I.Layout, I.ChevronD, etc.). Port these to your icon system (lucide-react is a close visual match for most of them; if you swap, audit each glyph for visual fidelity).

## Implementation notes

1. **Keep all bottom rails at 28px height.** This is the visual rhythm the design depends on. Sidebar footer, EditorMeta, GraphPanel legend — all 28px, all `var(--bg-1)`, all border-top `var(--line)`. Do not introduce a different-height status bar without also adjusting the others.

2. **Default density to `compact` (24px rows).** The prototype's default of `cozy` was for screenshot legibility.

3. **`html-to-image` / SSR:** the inline-style React in the prototype is fine for a client-rendered SPA. If you SSR (Next.js, Remix), be careful with the `useEffect`-applied `data-theme` — initialise it from a server-readable cookie or the user's profile to avoid theme flash.

4. **No emoji in the UI chrome.** The aesthetic is mono + iconography only. The only "emoji-adjacent" character used is `✦` in the AI hint (a U+2726 Black Four-Pointed Star).

5. **Avoid AI-slop tropes:** no left-border accent containers, no rounded gradient cards floating on a gradient background, no overly cute mascot illustrations. Stay true to the mono/oklch/dashed-underline language.

6. **Tweaks panel does not ship.** Surface the same options inside Settings.
