# Mnemo - Vim Keybindings & Keyboard-First Interface

## Overview
Transform Mnemo into a keyboard-first note-taking app with Vim-style navigation and editing.

## 1. Vim Keybindings in Editor

### Normal Mode (default when not typing)
| Key | Action |
|-----|--------|
| `h/j/k/l` | Left/down/up/right navigation |
| `w/b/e` | Word forward/back/end of word |
| `0/$` | Line start/end |
| `gg/G` | Document start/end |
| `dd` | Delete line |
| `yy` | Yank line |
| `p/P` | Paste after/before |
| `u` | Undo |
| `Ctrl+r` | Redo |
| `i/a` | Insert at cursor / append |
| `I/A` | Insert at line start / append at line end |
| `o/O` | New line below/above |
| `x` | Delete character |
| `r{char}` | Replace character |
| `/{search}` | Search in note |
| `n/N` | Next/previous search result |
| `[[` | Jump to previous heading |
| `]]` | Jump to next heading |
| `zz` | Center current line |
| `Esc` | Return to normal mode |

### Insert Mode
- Standard typing
- `Esc` returns to normal mode

### Visual Mode (optional for MVP)
- `v` enter visual mode
- `y` yank selection
- `d` delete selection

### Mode Indicator
- Show current mode in status bar: `-- NORMAL --` / `-- INSERT --` / `-- VISUAL --`
- Color coded: blue (normal), green (insert), orange (visual)

## 2. Global Keyboard Shortcuts

### Pane Toggles
| Shortcut | Action |
|----------|--------|
| `Ctrl+b` | Toggle file tree sidebar |
| `Ctrl+o` | Toggle outline pane |
| `Ctrl+g` | Toggle graph view |
| `Ctrl+/` | Focus search bar |
| `Ctrl+n` | New note |
| `Ctrl+s` | Save (already auto-saves, but show confirmation) |
| `Ctrl+w` | Close current note |

### Navigation
| Shortcut | Action |
|----------|--------|
| `Ctrl+p` | Quick note switcher (fuzzy search) |
| `Ctrl+Tab` | Switch to next note |
| `Ctrl+Shift+Tab` | Switch to previous note |
| `Ctrl+1-9` | Switch to note tab 1-9 |

### Note Actions
| Shortcut | Action |
|----------|--------|
| `Ctrl+Delete` | Delete current note (with confirmation) |
| `F2` | Rename note |
| `Ctrl+Shift+f` | Full-text search |

## 3. Outline Pane

### Location
- Right sidebar (opposite to file tree)
- Toggleable with `Ctrl+o`
- Width: 250px default, resizable

### Content
- Extract all headings from current note (lines starting with `#`, `##`, `###`, etc.)
- Show as collapsible tree
- Click heading to jump to that section
- Auto-update as you type

### Styling
```
H1 heading
  H2 heading
    H3 heading
  Another H2
```
- Indent based on heading level
- Active section highlighted
- Line numbers shown optionally

## 4. Status Bar

### Content
- Left: Current note path
- Center: Mode indicator (NORMAL/INSERT)
- Right: Line:Column, Word count

### Example
```
Projects/Mnemo Roadmap.md | -- INSERT -- | 42:18 | 1,234 words
```

## 5. Implementation Notes

### CodeMirror 6 Vim Mode
- Use `@replit/codemirror-vim` package
- Configure with:
```typescript
import { vim } from '@replit/codemirror-vim';
// Add to extensions
```

### Outline Extraction
- Parse markdown on content change
- Regex: `/^(#{1,6})\s+(.+)$/gm`
- Debounce updates (300ms)

### Keyboard Shortcut Manager
- Use a global hotkey handler
- Prevent default browser behavior
- Context-aware (different shortcuts in editor vs sidebar)

### Files to Create/Modify
- `packages/client/src/components/Editor/Editor.tsx` — Add vim mode
- `packages/client/src/components/Outline/OutlinePane.tsx` — New component
- `packages/client/src/components/StatusBar/StatusBar.tsx` — New component
- `packages/client/src/hooks/useKeyboardShortcuts.ts` — Global shortcuts
- `packages/client/src/App.tsx` — Integrate outline pane, status bar

## 6. Quality Requirements
- Zero lint errors
- Zero TypeScript errors
- Vim mode must feel snappy (no lag)
- Shortcuts must work consistently
- Mode indicator always visible
