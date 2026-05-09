import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileNode } from '../../lib/api';
import { Icons } from '../Icons';

interface QuickSwitcherProps {
  notes: FileNode[];
  onSelect: (path: string) => void;
  onClose: () => void;
  onNewNote?: () => void;
  onNewFolder?: () => void;
  onDailyNote?: () => void;
  onGraphView?: () => void;
  onSettings?: () => void;
}

interface NoteEntry {
  path: string;
  name: string;
}

interface ResultItem {
  kind: 'command' | 'note' | 'tag';
  icon: ReactNode;
  label: string;
  hint?: string;
  /** Path for notes; command id otherwise. */
  value?: string;
  onActivate?: () => void;
}

interface Section {
  title: string;
  items: ResultItem[];
}

const monoFamily = 'var(--font-mono)';
const sansFamily = 'var(--font-sans)';

function collectFiles(nodes: FileNode[]): NoteEntry[] {
  const files: NoteEntry[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      files.push({ path: node.path, name: node.name.replace(/\.md$/, '') });
    }
    if (node.children) {
      files.push(...collectFiles(node.children));
    }
  }
  return files;
}

export function QuickSwitcher({
  notes,
  onSelect,
  onClose,
  onNewNote,
  onNewFolder,
  onDailyNote,
  onGraphView,
  onSettings,
}: QuickSwitcherProps) {
  const allFiles = useMemo(() => collectFiles(notes), [notes]);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
  const mod = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const sections = useMemo<Section[]>(() => {
    const ql = q.trim().toLowerCase();

    const commands: ResultItem[] = [
      {
        kind: 'command',
        icon: <Icons.Plus size={13} />,
        label: 'New note',
        hint: `${mod}N`,
        onActivate: onNewNote,
      },
      {
        kind: 'command',
        icon: <Icons.FolderPlus size={13} />,
        label: 'New folder',
        hint: `${mod}⇧N`,
        onActivate: onNewFolder,
      },
      {
        kind: 'command',
        icon: <Icons.Calendar size={13} />,
        label: 'Daily note',
        hint: `${mod}D`,
        onActivate: onDailyNote,
      },
      {
        kind: 'command',
        icon: <Icons.Network size={13} />,
        label: 'Graph view',
        hint: `${mod}G`,
        onActivate: onGraphView,
      },
      {
        kind: 'command',
        icon: <Icons.Settings size={13} />,
        label: 'Settings',
        hint: `${mod},`,
        onActivate: onSettings,
      },
    ];

    const noteHits = allFiles
      .filter((n) => !ql || n.name.toLowerCase().includes(ql) || n.path.toLowerCase().includes(ql))
      .slice(0, 20)
      .map<ResultItem>((n) => ({
        kind: 'note',
        icon: <Icons.FileText size={13} />,
        label: n.name,
        hint: n.path,
        value: n.path,
      }));

    if (ql) {
      const cmdHits = commands.filter((c) => c.label.toLowerCase().includes(ql));
      const out: Section[] = [];
      if (cmdHits.length) out.push({ title: 'Commands', items: cmdHits });
      if (noteHits.length) out.push({ title: `Notes (${noteHits.length})`, items: noteHits });
      return out;
    }

    return [
      { title: 'Commands', items: commands },
      { title: 'Notes', items: noteHits.slice(0, 8) },
    ];
  }, [q, allFiles, mod, onNewNote, onNewFolder, onDailyNote, onGraphView, onSettings]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Clamp idx when results change
  useEffect(() => {
    if (idx > flat.length - 1) setIdx(0);
  }, [flat.length, idx]);

  const activate = (item: ResultItem) => {
    if (item.onActivate) {
      item.onActivate();
      onClose();
      return;
    }
    if (item.kind === 'note' && item.value) {
      onSelect(item.value);
      onClose();
      return;
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = flat[idx];
      if (sel) activate(sel);
    }
  };

  const sectionHeader: CSSProperties = {
    padding: '8px 10px 4px',
    fontSize: 10.5,
    fontFamily: monoFamily,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--fg-4)',
  };

  let runningIndex = 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'oklch(0 0 0 / 0.45)',
        zIndex: 100,
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 580,
          maxWidth: '90vw',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-strong)',
          borderRadius: 10,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <Icons.Search size={16} style={{ color: 'var(--accent)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search notes, run a command…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--fg)',
              fontSize: 15,
              fontFamily: sansFamily,
            }}
          />
          <span className="kbd">esc</span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '4px 6px 6px' }}>
          {flat.length === 0 && (
            <div
              style={{
                padding: 30,
                textAlign: 'center',
                color: 'var(--fg-3)',
                fontFamily: sansFamily,
                fontSize: 13,
              }}
            >
              No matches.
            </div>
          )}

          {sections.map((section) => {
            if (section.items.length === 0) return null;
            return (
              <div key={section.title}>
                <div style={sectionHeader}>{section.title}</div>
                {section.items.map((item) => {
                  const i = runningIndex++;
                  const sel = i === idx;
                  return (
                    <button
                      key={i}
                      type="button"
                      onMouseEnter={() => setIdx(i)}
                      onClick={() => activate(item)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: 'none',
                        background: sel ? 'var(--accent-soft)' : 'transparent',
                        color: sel ? 'var(--fg)' : 'var(--fg-1)',
                        fontSize: 13,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          color: sel ? 'var(--accent)' : 'var(--fg-3)',
                          width: 18,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {item.icon}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                      </span>
                      {item.hint && (
                        <span
                          className="mono"
                          style={{
                            color: 'var(--fg-4)',
                            fontSize: 11,
                            opacity: 0.85,
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer rail */}
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '8px 14px',
            background: 'var(--bg-1)',
            borderTop: '1px solid var(--line)',
            fontSize: 11,
            fontFamily: monoFamily,
            color: 'var(--fg-3)',
            flexShrink: 0,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="kbd">↑↓</span> navigate
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="kbd">↵</span> open
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="kbd">{mod}</span>
            <span className="kbd">↵</span> open in split
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
            <span className="dot pulse" style={{ background: 'var(--accent)' }} />
            AI search ready
          </span>
        </div>
      </div>
    </div>
  );
}
