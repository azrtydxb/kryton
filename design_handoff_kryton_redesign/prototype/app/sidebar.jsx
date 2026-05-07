/* global React, I */
const { useState: useS1 } = React;

function Sidebar({ activeId, onSelect, onOpenView, currentView, density = 'cozy', onCollapse }) {
  const { NOTES, FOLDERS, TAGS } = window.K_DATA;
  const [expanded, setExpanded] = useS1(() => Object.fromEntries(FOLDERS.map(f => [f.name, f.expanded])));
  const [favOpen, setFavOpen] = useS1(true);
  const [tagsOpen, setTagsOpen] = useS1(true);
  const [recentOpen, setRecentOpen] = useS1(true);

  const noteById = (id) => NOTES.find(n => n.id === id);
  const favorites = NOTES.filter(n => n.starred);

  const rowH = density === 'compact' ? 24 : density === 'comfy' ? 32 : 28;
  const padY = density === 'compact' ? 2 : density === 'comfy' ? 6 : 4;

  const Row = ({ icon, label, active, hint, onClick, indent = 0, muted, accent, children }) => (
    <button
      onClick={onClick}
      className="kr-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        height: rowH, paddingLeft: 8 + indent * 14, paddingRight: 8,
        borderRadius: 6, color: active ? 'var(--fg)' : muted ? 'var(--fg-3)' : 'var(--fg-1)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        position: 'relative', textAlign: 'left',
        fontSize: 'var(--fs-base)',
        transition: 'background 120ms, color 120ms',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <span style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 2, background: 'var(--accent)', borderRadius: 2 }} />}
      <span style={{ color: accent ? 'var(--accent)' : active ? 'var(--accent)' : 'var(--fg-3)', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {children}
      {hint != null && <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 11 }}>{hint}</span>}
    </button>
  );

  const SectionHeader = ({ open, setOpen, label, count, actions }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, height: 26,
      padding: '0 8px 0 6px', color: 'var(--fg-3)',
      fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase',
      fontFamily: 'var(--font-mono)', fontWeight: 500,
    }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', color: 'inherit' }}>
        <I.ChevronD size={11} style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}/>
      </button>
      <span>{label}</span>
      {count != null && <span className="mono" style={{ color: 'var(--fg-4)' }}>{count}</span>}
      <div style={{ flex: 1 }} />
      {actions}
    </div>
  );

  return (
    <aside style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--line)',
      fontSize: 'var(--fs-base)',
    }}>
      {/* sidebar header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 10px 6px', height: 44 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flex: 1,
          padding: '4px 8px', borderRadius: 6, color: 'var(--fg-2)',
        }}>
          <I.Logo size={18}/>
          <span className="mono" style={{ fontWeight: 600, color: 'var(--fg)', letterSpacing: 0.5 }}>kryton</span>
          <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 10 }}>v0.4.2</span>
        </div>
        <button onClick={onCollapse} title="Collapse sidebar (⌘B)" className="kr-icon-btn"
          style={{ width: 26, height: 26, borderRadius: 5, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={(e)=>{e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--fg)';}}
          onMouseLeave={(e)=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--fg-3)';}}>
          <I.PanelLeft size={14}/>
        </button>
      </div>

      {/* primary nav */}
      <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Row icon={<I.Inbox size={14}/>} label="All notes" active={currentView === 'all'} onClick={() => onOpenView('all')} hint={NOTES.length} />
        <Row icon={<I.Calendar size={14}/>} label="Daily note" onClick={() => onSelect('daily-2026-05-07')} hint="today"/>
        <Row icon={<I.Network size={14}/>} label="Graph" active={currentView === 'graph'} onClick={() => onOpenView('graph')}/>
        <Row icon={<I.Hash size={14}/>} label="Tags" hint={TAGS.length}/>
      </div>

      <div style={{ height: 1, background: 'var(--line)', margin: '4px 12px' }} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        {/* favorites */}
        <SectionHeader
          open={favOpen} setOpen={setFavOpen}
          label="Favorites" count={favorites.length}
        />
        {favOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 }}>
            {favorites.length === 0 ? (
              <div style={{ padding: '6px 12px', color: 'var(--fg-4)', fontSize: 11.5, fontStyle: 'italic' }}>
                No favorites yet · ⌘⇧S
              </div>
            ) : favorites.map(n => (
              <Row key={n.id} icon={<I.StarOn size={12} style={{ color: 'var(--accent-warn)' }}/>}
                label={n.title} active={activeId === n.id} onClick={() => onSelect(n.id)} indent={0}/>
            ))}
          </div>
        )}

        {/* folders */}
        <SectionHeader
          open={true} setOpen={() => {}} label="Files"
          actions={
            <div style={{ display: 'flex', gap: 2 }}>
              <IconBtn title="New note (⌘N)"><I.Plus size={12}/></IconBtn>
              <IconBtn title="New folder"><I.FolderPlus size={12}/></IconBtn>
            </div>
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 8 }}>
          {FOLDERS.map(f => (
            <React.Fragment key={f.name}>
              <Row
                icon={expanded[f.name] ? <I.FolderOpen size={14}/> : <I.Folder size={14}/>}
                label={f.name}
                hint={f.count}
                onClick={() => setExpanded(s => ({ ...s, [f.name]: !s[f.name] }))}
              />
              {expanded[f.name] && f.children.map(cid => {
                const n = noteById(cid);
                if (!n) return null;
                return (
                  <Row key={cid} icon={<I.FileText size={12}/>} label={n.title}
                    active={activeId === cid}
                    onClick={() => onSelect(cid)} indent={1} />
                );
              })}
            </React.Fragment>
          ))}

          {/* loose notes */}
          {NOTES.filter(n => !n.folder).map(n => (
            <Row key={n.id} icon={<I.FileText size={12}/>} label={n.title}
              active={activeId === n.id} onClick={() => onSelect(n.id)} />
          ))}
        </div>

        {/* tags */}
        <SectionHeader open={tagsOpen} setOpen={setTagsOpen} label="Tags" count={TAGS.length} />
        {tagsOpen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 6px 8px' }}>
            {TAGS.slice(0, 11).map(t => (
              <button key={t.name} className="kr-tag" style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 7px 3px 6px', borderRadius: 4,
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                color: 'var(--fg-1)', fontSize: 11.5,
                fontFamily: 'var(--font-mono)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--fg-1)'; }}
              >
                <span style={{ color: 'var(--fg-3)' }}>#</span>{t.name}
                <span style={{ color: 'var(--fg-4)', marginLeft: 2 }}>{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* footer / agents */}
      <AgentsFooter />
    </aside>
  );
}

function IconBtn({ children, title, onClick }) {
  return (
    <button onClick={onClick} title={title}
      style={{
        width: 22, height: 22, borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--fg-3)',
      }}
      onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--fg)';}}
      onMouseLeave={e=>{e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--fg-3)';}}
    >{children}</button>
  );
}

function AgentsFooter() {
  return (
    <div style={{
      borderTop: '1px solid var(--line)', height: 28, padding: '0 10px',
      display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
      fontFamily: 'var(--font-mono)', color: 'var(--fg-2)',
      background: 'var(--bg-1)', flexShrink: 0,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 6px', borderRadius: 3,
        background: 'var(--accent-soft)', color: 'var(--accent)',
      }}>
        <span className="dot pulse" style={{ background: 'var(--accent)', width: 5, height: 5, boxShadow: 'none' }}/>
        MCP
      </span>
      <span style={{ color: 'var(--fg-3)' }}>2 agents online</span>
      <div style={{ flex: 1 }}/>
      <span title="Claude" style={{
        width: 16, height: 16, borderRadius: '50%', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-2)', border: '1px solid var(--line)', fontSize: 9.5,
      }}>C</span>
      <span title="Cursor" style={{
        width: 16, height: 16, borderRadius: '50%', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-2)', border: '1px solid var(--line)', fontSize: 9.5,
      }}>↗</span>
    </div>
  );
}

window.Sidebar = Sidebar;
