/* global React, I */
const { useState: useEd1, useEffect: useEd2, useRef: useEd3 } = React;

/* Header / command bar */
function TopBar({ onTogglePalette, onToggleTheme, theme }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 10, height: 44,
      padding: '0 10px 0 12px',
      background: 'var(--bg)', borderBottom: '1px solid var(--line)',
      fontSize: 'var(--fs-base)',
      flexShrink: 0,
    }}>
      <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 11.5 }}>~/notes</span>
      <span style={{ color: 'var(--fg-4)' }}>›</span>
      <span className="mono" style={{ color: 'var(--fg-1)', fontSize: 11.5 }}>Welcome.md</span>

      <div style={{ flex: 1 }}/>

      <button onClick={onTogglePalette} className="kr-cmd"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px 5px 10px', borderRadius: 6,
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          color: 'var(--fg-2)', minWidth: 320, height: 30,
        }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor = 'var(--line-strong)';}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor = 'var(--line)';}}
      >
        <I.Search size={13}/>
        <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5 }}>Search or jump to…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div style={{ flex: 1 }}/>

      <HeaderBtn title="New note (⌘N)"><I.Plus size={14}/></HeaderBtn>
      <HeaderBtn title="History"><I.History size={14}/></HeaderBtn>
      <HeaderBtn onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? <I.Sun size={14}/> : <I.Moon size={14}/>}
      </HeaderBtn>
      <HeaderBtn title="Settings"><I.Settings size={14}/></HeaderBtn>

      <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }}/>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '3px 4px 3px 8px', borderRadius: 16,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
      }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>pascal</span>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent-fg)', fontWeight: 600, fontSize: 11,
        }}>P</span>
      </div>
    </header>
  );
}

function HeaderBtn({ children, title, onClick }) {
  return (
    <button onClick={onClick} title={title}
      style={{ width: 30, height: 30, borderRadius: 6, color: 'var(--fg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--fg)';}}
      onMouseLeave={e=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--fg-2)';}}
    >{children}</button>
  );
}

/* Editor pane */
function Editor({ note, mode = 'split', onModeChange }) {
  if (!note) return <EmptyState />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', minWidth: 0 }}>
      <EditorTabBar note={note} mode={mode} onModeChange={onModeChange}/>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {(mode === 'edit' || mode === 'split') && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
                        borderRight: mode === 'split' ? '1px solid var(--line)' : 'none' }}>
            <EditorBody note={note}/>
          </div>
        )}
        {(mode === 'preview' || mode === 'split') && (
          <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
            <PreviewBody note={note}/>
          </div>
        )}
      </div>
      <EditorMeta note={note}/>
    </div>
  );
}

function EditorTabBar({ note, mode, onModeChange }) {
  const ModeBtn = ({ m, icon, label }) => (
    <button onClick={() => onModeChange(m)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 8px', borderRadius: 5,
        fontSize: 11.5, fontFamily: 'var(--font-mono)',
        color: mode === m ? 'var(--accent)' : 'var(--fg-2)',
        background: mode === m ? 'var(--accent-soft)' : 'transparent',
      }}
      onMouseEnter={e=>{ if(mode!==m) e.currentTarget.style.background='var(--bg-hover)'; }}
      onMouseLeave={e=>{ if(mode!==m) e.currentTarget.style.background='transparent'; }}
    >
      {icon}{label}
    </button>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 38, padding: '0 12px', borderBottom: '1px solid var(--line)',
      background: 'var(--bg)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-2)' }}>
        <I.FileText size={13} style={{ color: 'var(--accent)' }}/>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg)' }}>{note.path.replace(/^\//, '')}</span>
      </span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        marginLeft: 4, padding: '2px 6px', borderRadius: 3,
        background: 'var(--bg-1)', border: '1px solid var(--line)',
        fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)',
      }}>
        <span className="dot pulse" style={{ width: 5, height: 5, background: 'var(--accent-good)', boxShadow: 'none' }}/>
        saved
      </span>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: 2, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 7 }}>
        <ModeBtn m="edit"    icon={<I.Edit size={11}/>}    label="Edit"/>
        <ModeBtn m="split"   icon={<I.Layout size={11}/>}  label="Split"/>
        <ModeBtn m="preview" icon={<I.Eye size={11}/>}     label="Preview"/>
      </div>

      <HeaderBtn title="Toggle favorite">{note.starred ? <I.StarOn size={13} style={{color:'var(--accent-warn)'}}/> : <I.Star size={13}/>}</HeaderBtn>
      <HeaderBtn title="Share"><I.Share size={13}/></HeaderBtn>
      <HeaderBtn title="More"><I.More size={13}/></HeaderBtn>
    </div>
  );
}

/* Markdown source rendered with light syntax highlighting via spans */
function EditorBody({ note }) {
  const lines = (note.body || '').split('\n');
  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '52px 1fr',
        fontFamily: 'var(--font-mono)', fontSize: 13.5, lineHeight: '22px',
        padding: '20px 0', minHeight: '100%',
      }}>
        {lines.map((ln, i) => (
          <React.Fragment key={i}>
            <div style={{
              textAlign: 'right', paddingRight: 14,
              color: 'var(--fg-4)', userSelect: 'none', fontSize: 11.5,
            }}>{i + 1}</div>
            <div style={{ paddingRight: 28, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <MdLine line={ln}/>
            </div>
          </React.Fragment>
        ))}
        <div style={{ height: 200 }}/>
      </div>
    </div>
  );
}

function MdLine({ line }) {
  if (/^#{1,6}\s/.test(line)) {
    const m = line.match(/^(#{1,6})\s(.*)$/);
    return <><span style={{ color: 'var(--accent-2)' }}>{m[1]}</span> <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{m[2]}</span></>;
  }
  if (/^\s*-\s/.test(line)) {
    const m = line.match(/^(\s*-\s)(.*)$/);
    return <><span style={{ color: 'var(--accent)' }}>{m[1]}</span><MdInline text={m[2]}/></>;
  }
  return <MdInline text={line}/>;
}

function MdInline({ text }) {
  const parts = [];
  let i = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;
  let m, last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={i++} style={{ color: 'var(--fg-1)' }}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith('**')) parts.push(<span key={i++} style={{ color: 'var(--accent-warn)', fontWeight: 600 }}>{tok}</span>);
    else if (tok.startsWith('`')) parts.push(<span key={i++} style={{ background: 'var(--code-bg)', color: 'var(--code-fg)', padding: '0 4px', borderRadius: 3 }}>{tok}</span>);
    else parts.push(<span key={i++} style={{ color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dashed', textUnderlineOffset: 3 }}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<span key={i++} style={{ color: 'var(--fg-1)' }}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

function PreviewBody({ note }) {
  return (
    <div style={{
      padding: '36px 48px 80px', maxWidth: 760, margin: '0 auto',
      fontFamily: 'var(--font-sans)', fontSize: 15, lineHeight: 1.7,
      color: 'var(--fg-1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-3)' }}>
        <I.FileText size={11}/>
        <span>{note.path}</span>
        <span>·</span>
        <span>{note.words} words</span>
        <span>·</span>
        <span>updated {new Date(note.updated).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' })}</span>
      </div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, margin: '4px 0 18px', color: 'var(--fg)', letterSpacing: -0.4 }}>{note.title}</h1>

      <p>Your <strong style={{ color: 'var(--fg)' }}>shared brain</strong> for people and AI. Notes live in plain Markdown, link with <a style={linkStyle}>wiki-links</a>, and anything an MCP-aware agent can read, you can read too.</p>

      <h2 style={h2Style}>Getting started</h2>
      <ul style={ulStyle}>
        <li>Hit <code style={codeStyle}>Ctrl K</code> to search anything</li>
        <li>Hit <code style={codeStyle}>Ctrl N</code> to create a note</li>
        <li>Hit <code style={codeStyle}>Ctrl P</code> to jump between notes</li>
        <li>Use <code style={codeStyle}>[[double brackets]]</code> to link</li>
        <li>Toggle the <a style={linkStyle}>Graph View</a> to see how it all connects</li>
      </ul>

      <h2 style={h2Style}>What makes Kryton different</h2>
      <ul style={ulStyle}>
        <li><strong style={{ color: 'var(--fg)' }}>Self-hosted.</strong> Your notes, your server.</li>
        <li><strong style={{ color: 'var(--fg)' }}>MCP server built in.</strong> Claude, Cursor, and any MCP agent can read and write <code style={codeStyle}>/api/mcp</code>.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Real graph.</strong> Not decorative — backlinks and traversal are first-class.</li>
        <li><strong style={{ color: 'var(--fg)' }}>Markdown all the way down.</strong> Plain files, no lock-in.</li>
      </ul>

      {/* Backlinks rail */}
      <div style={{ marginTop: 36, paddingTop: 18, borderTop: '1px dashed var(--line)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <I.Link size={10}/> Backlinks <span style={{ color: 'var(--fg-4)' }}>· {note.backlinks?.length || 0}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(note.backlinks || []).map(id => {
            const n = window.K_DATA.NOTES.find(x => x.id === id);
            if (!n) return null;
            return (
              <div key={id} style={{
                padding: '8px 10px', borderRadius: 6, background: 'var(--bg-1)', border: '1px solid var(--line)',
                fontSize: 13, color: 'var(--fg-1)', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <I.FileText size={12} style={{ color: 'var(--accent)' }}/>
                <span>{n.title}</span>
                <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{n.path}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const h2Style = { fontFamily: 'var(--font-display)', fontSize: 18, margin: '28px 0 10px', color: 'var(--fg)', letterSpacing: -0.2 };
const ulStyle = { paddingLeft: 22, margin: '8px 0' };
const linkStyle = { color: 'var(--link)', textDecoration: 'underline', textDecorationStyle: 'dashed', textUnderlineOffset: 3, cursor: 'pointer' };
const codeStyle = { fontFamily: 'var(--font-mono)', fontSize: '0.88em', background: 'var(--code-bg)', color: 'var(--code-fg)', padding: '1px 6px', borderRadius: 4 };

function EditorMeta({ note }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      height: 28, padding: '0 12px',
      background: 'var(--bg-1)', borderTop: '1px solid var(--line)',
      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)',
    }}>
      <span><span style={{ color: 'var(--accent)' }}>{note.outgoing?.length || 0}</span> outgoing</span>
      <span><span style={{ color: 'var(--accent-2)' }}>{note.backlinks?.length || 0}</span> backlinks</span>
      <span>{note.tags.length} tags</span>
      <div style={{ flex: 1 }}/>
      <span>{note.words} words</span>
      <span>Ln 1, Col 1</span>
      <span>UTF-8</span>
      <span>Markdown</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-grid" style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 18, padding: 40,
    }}>
      <div style={{
        position: 'relative', width: 96, height: 96, borderRadius: 18,
        background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--accent)',
      }}>
        <I.Logo size={56}/>
        <span style={{ position: 'absolute', top: -8, right: -8, padding: '2px 7px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--accent)', color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--font-mono)' }}>idle</span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--fg)', marginBottom: 4 }}>Ready when you are.</div>
        <div style={{ color: 'var(--fg-2)', fontSize: 13 }}>Open a note from the sidebar, or start a new one.</div>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto auto', gap: '6px 14px', marginTop: 10,
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--fg-2)',
      }}>
        <span style={{textAlign:'right'}}><span className="kbd">⌘N</span></span><span>new note</span>
        <span style={{textAlign:'right'}}><span className="kbd">⌘P</span></span><span>quick switcher</span>
        <span style={{textAlign:'right'}}><span className="kbd">⌘K</span></span><span>search</span>
        <span style={{textAlign:'right'}}><span className="kbd">⌘B</span></span><span>toggle sidebar</span>
        <span style={{textAlign:'right'}}><span className="kbd">⌘G</span></span><span>graph view</span>
      </div>
    </div>
  );
}

window.TopBar = TopBar;
window.Editor = Editor;
window.HeaderBtn = HeaderBtn;
window.EmptyState = EmptyState;
