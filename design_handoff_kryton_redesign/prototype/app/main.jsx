/* global React, ReactDOM, Sidebar, TopBar, Editor, GraphPanel, CommandPalette, StatusBar, AllNotesView, LoginScreen, I, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle, TweakSelect */
const { useState, useEffect, useRef, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "violet",
  "fontPair": "jetbrains-inter",
  "density": "cozy",
  "graphPosition": "right",
  "layout": "split",
  "scanlines": false
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  'jetbrains-inter': { mono: "'JetBrains Mono', ui-monospace, monospace", sans: "'Inter', ui-sans-serif, system-ui, sans-serif", display: "'JetBrains Mono', ui-monospace, monospace" },
  'ibm-inter':       { mono: "'IBM Plex Mono', ui-monospace, monospace", sans: "'Inter', ui-sans-serif, system-ui, sans-serif", display: "'IBM Plex Mono', ui-monospace, monospace" },
  'jetbrains-serif': { mono: "'JetBrains Mono', ui-monospace, monospace", sans: "'Inter', ui-sans-serif, system-ui, sans-serif", display: "'Instrument Serif', Georgia, serif" },
  'mono-only':       { mono: "'JetBrains Mono', ui-monospace, monospace", sans: "'JetBrains Mono', ui-monospace, monospace", display: "'JetBrains Mono', ui-monospace, monospace" },
};

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // App-internal state
  const [authed, setAuthed] = useState(true);
  const [route, setRoute] = useState('app'); // app | login | settings
  const [activeNoteId, setActiveNoteId] = useState('welcome');
  const [view, setView] = useState('note'); // note | all | graph
  const [editorMode, setEditorMode] = useState(t.layout); // edit | split | preview
  const [graphMode, setGraphMode] = useState('local');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => { setEditorMode(t.layout); }, [t.layout]);

  // global keys
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (meta && e.key.toLowerCase() === 'p') { e.preventDefault(); setPaletteOpen(true); }
      if (meta && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarOpen(s => !s); }
      if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); setView('all'); }
      if (meta && e.key.toLowerCase() === 'g') { e.preventDefault(); setView(v => v === 'graph' ? 'note' : 'graph'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // theme application
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = t.theme;
    root.dataset.accent = t.accent;
    root.dataset.density = t.density;
    const fp = FONT_PAIRS[t.fontPair] || FONT_PAIRS['jetbrains-inter'];
    root.style.setProperty('--font-mono', fp.mono);
    root.style.setProperty('--font-sans', fp.sans);
    root.style.setProperty('--font-display', fp.display);
  }, [t.theme, t.accent, t.density, t.fontPair]);

  const note = useMemo(() => window.K_DATA.NOTES.find(n => n.id === activeNoteId), [activeNoteId]);

  const handleSelect = (id) => {
    setActiveNoteId(id);
    setView('note');
    setRoute('app');
  };

  if (!authed || route === 'login') {
    return (
      <>
        <LoginScreen onSignIn={() => { setAuthed(true); setRoute('app'); }}/>
        <TweaksUI t={t} setTweak={setTweak}/>
      </>
    );
  }

  // layout columns
  const cols = [];
  if (sidebarOpen) cols.push('260px');
  cols.push('1fr');
  if (t.graphPosition === 'right' && view !== 'graph') cols.push('340px');

  const sidebarPane = (
    <Sidebar
      activeId={view === 'note' ? activeNoteId : null}
      onSelect={handleSelect}
      onOpenView={(v) => { setView(v); }}
      currentView={view === 'all' ? 'all' : view === 'graph' ? 'graph' : null}
      density={t.density}
      onCollapse={() => setSidebarOpen(false)}
    />
  );

  let main;
  if (view === 'all') main = <AllNotesView onSelect={handleSelect}/>;
  else if (view === 'graph') main = <GraphPanel activeId={activeNoteId} onSelect={handleSelect} mode="global" onModeChange={()=>{}} fullscreen/>;
  else main = <Editor note={note} mode={editorMode} onModeChange={setEditorMode}/>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <TopBar
        onTogglePalette={() => setPaletteOpen(true)}
        onToggleTheme={() => setTweak({ theme: t.theme === 'dark' ? 'light' : 'dark' })}
        theme={t.theme}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
      />

      <div style={{
        flex: 1, display: 'grid', gridTemplateColumns: cols.join(' '),
        minHeight: 0,
      }}>
        {sidebarOpen && sidebarPane}
        {main}
        {t.graphPosition === 'right' && view !== 'graph' && (
          <GraphPanel activeId={activeNoteId} onSelect={handleSelect} mode={graphMode} onModeChange={setGraphMode}/>
        )}
      </div>

      {/* Status bar removed — info was redundant with sidebar footer + editor chrome */}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSelect={handleSelect}/>

      <TweaksUI t={t} setTweak={setTweak} onShowLogin={() => setRoute('login')} onShowApp={() => setRoute('app')}/>

      {/* Floating screen switcher (bottom-left) — for demo */}
      <ScreenSwitcher route={route} setRoute={setRoute} view={view} setView={setView}/>
    </div>
  );
}

function ScreenSwitcher({ route, setRoute, view, setView }) {
  const [open, setOpen] = useState(false);
  const items = [
    { id: 'app',     label: 'Editor',       action: () => { setRoute('app'); setView('note'); } },
    { id: 'all',     label: 'All notes',    action: () => { setRoute('app'); setView('all'); } },
    { id: 'graph',   label: 'Graph (full)', action: () => { setRoute('app'); setView('graph'); } },
    { id: 'login',   label: 'Login',        action: () => { setRoute('login'); } },
  ];
  const currentId = route === 'login' ? 'login' : view === 'all' ? 'all' : view === 'graph' ? 'graph' : 'app';
  return (
    <div style={{ position: 'fixed', left: 12, bottom: 12 + 26, zIndex: 50 }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: 36, left: 0, minWidth: 180,
          background: 'var(--bg-1)', border: '1px solid var(--line-strong)',
          borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 4,
        }}>
          <div style={{ padding: '6px 10px 4px', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>screens · demo</div>
          {items.map(it => (
            <button key={it.id} onClick={() => { it.action(); setOpen(false); }}
              style={{
                width: '100%', textAlign: 'left',
                padding: '7px 10px', borderRadius: 5, fontSize: 12.5,
                background: it.id === currentId ? 'var(--accent-soft)' : 'transparent',
                color: it.id === currentId ? 'var(--accent)' : 'var(--fg-1)',
                fontFamily: 'var(--font-mono)',
              }}>{it.label}</button>
          ))}
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 9px 5px 8px', borderRadius: 6,
          background: 'var(--bg-1)', border: '1px solid var(--line)',
          color: 'var(--fg-2)', display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          boxShadow: 'var(--shadow-md)',
        }}
        title="Switch screen (demo)">
        <I.Layout size={12}/>
        <span>screen</span>
        <I.ChevronD size={11} style={{ transform: open ? 'rotate(180deg)' : 'none' }}/>
      </button>
    </div>
  );
}

function TweaksUI({ t, setTweak }) {
  return (
    <TweaksPanel title="Tweaks" defaultOpen={false}>
      <TweakSection title="Appearance">
        <TweakRadio label="Theme" value={t.theme} onChange={(v) => setTweak({ theme: v })}
          options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}/>
        <TweakColor label="Accent" value={t.accent} onChange={(v) => setTweak({ accent: v })}
          options={['violet', 'cyan', 'green', 'amber', 'rose'].map(name => ({
            value: name,
            color: ({ violet:'#9b6cf3', cyan:'#5cc7d6', green:'#5fce99', amber:'#e0a557', rose:'#e36d7e' })[name],
          }))}/>
      </TweakSection>

      <TweakSection title="Typography">
        <TweakSelect label="Fonts" value={t.fontPair} onChange={(v) => setTweak({ fontPair: v })}
          options={[
            { value: 'jetbrains-inter', label: 'JetBrains Mono + Inter' },
            { value: 'ibm-inter',       label: 'IBM Plex Mono + Inter' },
            { value: 'jetbrains-serif', label: 'Mono + Instrument Serif' },
            { value: 'mono-only',       label: 'Mono everywhere' },
          ]}/>
      </TweakSection>

      <TweakSection title="Layout">
        <TweakRadio label="Editor" value={t.layout} onChange={(v) => setTweak({ layout: v })}
          options={[{ value: 'edit', label: 'Edit' }, { value: 'split', label: 'Split' }, { value: 'preview', label: 'Preview' }]}/>
        <TweakRadio label="Density" value={t.density} onChange={(v) => setTweak({ density: v })}
          options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'comfy', label: 'Comfy' }]}/>
        <TweakRadio label="Graph" value={t.graphPosition} onChange={(v) => setTweak({ graphPosition: v })}
          options={[{ value: 'right', label: 'Side' }, { value: 'hidden', label: 'Hidden' }]}/>
      </TweakSection>
    </TweaksPanel>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App/>);
