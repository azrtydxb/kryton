/* global React, I */
const { useState: useP1, useEffect: useP2, useRef: useP3, useMemo: useP4 } = React;

function CommandPalette({ open, onClose, onSelect }) {
  const { NOTES } = window.K_DATA;
  const [q, setQ] = useP1('');
  const [idx, setIdx] = useP1(0);
  const inputRef = useP3(null);

  useP2(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const COMMANDS = [
    { kind: 'cmd', icon: <I.Plus size={13}/>, label: 'New note', hint: '⌘N' },
    { kind: 'cmd', icon: <I.FolderPlus size={13}/>, label: 'New folder', hint: '⌘⇧N' },
    { kind: 'cmd', icon: <I.Calendar size={13}/>, label: "Open today's daily note", hint: '⌘D' },
    { kind: 'cmd', icon: <I.Network size={13}/>, label: 'Open graph view', hint: '⌘G' },
    { kind: 'cmd', icon: <I.Settings size={13}/>, label: 'Open settings', hint: '⌘,' },
  ];

  const items = useP4(() => {
    if (!q) {
      return [
        { section: 'Commands', items: COMMANDS },
        { section: 'Recent notes', items: NOTES.slice(0, 5).map(n => ({ kind: 'note', icon: <I.FileText size={13}/>, label: n.title, hint: n.path, id: n.id })) },
      ];
    }
    const ql = q.toLowerCase();
    const noteHits = NOTES.filter(n => n.title.toLowerCase().includes(ql) || n.tags.some(t => t.includes(ql)))
      .map(n => ({ kind: 'note', icon: <I.FileText size={13}/>, label: n.title, hint: n.path, id: n.id }));
    const cmdHits = COMMANDS.filter(c => c.label.toLowerCase().includes(ql));
    return [
      ...(cmdHits.length ? [{ section: 'Commands', items: cmdHits }] : []),
      ...(noteHits.length ? [{ section: `Notes (${noteHits.length})`, items: noteHits }] : []),
    ];
  }, [q]);

  const flat = items.flatMap(g => g.items);

  if (!open) return null;
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'oklch(0 0 0 / 0.45)', zIndex: 100, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 100 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 580, maxWidth: '90vw', background: 'var(--bg-1)', border: '1px solid var(--line-strong)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <I.Search size={16} style={{ color: 'var(--accent)' }}/>
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(flat.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
              if (e.key === 'Enter') {
                const sel = flat[idx];
                if (sel?.kind === 'note') { onSelect?.(sel.id); onClose(); }
                else onClose();
              }
            }}
            placeholder="Search notes, run a command…"
            style={{ flex: 1, background: 'transparent', border: 0, outline: 'none', color: 'var(--fg)', fontSize: 15, fontFamily: 'var(--font-sans)' }}/>
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto', padding: 6 }}>
          {items.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>No matches.</div>
          )}
          {items.map((g, gi) => {
            let runningIdx = items.slice(0, gi).reduce((a, b) => a + b.items.length, 0);
            return (
              <div key={g.section}>
                <div style={{ padding: '8px 10px 4px', fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-4)' }}>{g.section}</div>
                {g.items.map((it, ii) => {
                  const i = runningIdx + ii;
                  const sel = i === idx;
                  return (
                    <button key={ii} onMouseEnter={() => setIdx(i)}
                      onClick={() => { if (it.kind === 'note') { onSelect?.(it.id); onClose(); } else onClose(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: '8px 10px', borderRadius: 6,
                        background: sel ? 'var(--accent-soft)' : 'transparent',
                        color: sel ? 'var(--fg)' : 'var(--fg-1)',
                        fontSize: 13, textAlign: 'left',
                      }}>
                      <span style={{ color: sel ? 'var(--accent)' : 'var(--fg-3)' }}>{it.icon}</span>
                      <span style={{ flex: 1 }}>{it.label}</span>
                      <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 11 }}>{it.hint || ''}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--line)', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span><span className="kbd">⌘↵</span> open in split</span>
          <div style={{ flex: 1 }}/>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="dot pulse" style={{ background: 'var(--accent)' }}/> AI search ready
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ note, mode, layout }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      height: 26, padding: '0 12px',
      background: 'var(--bg-1)', borderTop: '1px solid var(--line)',
      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)',
      flexShrink: 0,
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent-good)' }}>
        <span className="dot pulse" style={{ background: 'var(--accent-good)', boxShadow: 'none', width: 6, height: 6 }}/>
        synced
      </span>
      <span>{window.K_DATA.NOTES.length} notes · {new Set(window.K_DATA.NOTES.flatMap(n => n.tags)).size} tags</span>
      <div style={{ flex: 1 }}/>
      <span>layout: <span style={{ color: 'var(--fg-1)' }}>{layout}</span></span>
      <span>view: <span style={{ color: 'var(--fg-1)' }}>{mode}</span></span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
        <I.Bot size={11}/> 2 agents · MCP /api/mcp
      </span>
    </div>
  );
}

window.CommandPalette = CommandPalette;
window.StatusBar = StatusBar;
