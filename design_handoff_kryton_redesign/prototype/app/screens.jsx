/* global React, I */
const { useState: useScr1 } = React;

/* All notes view (when no specific note selected, but "All notes" clicked) */
function AllNotesView({ onSelect }) {
  const { NOTES } = window.K_DATA;
  const [view, setView] = useScr1('list');
  const [sort, setSort] = useScr1('updated');

  const sorted = [...NOTES].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return new Date(b.updated) - new Date(a.updated);
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: 38, padding: '0 16px', borderBottom: '1px solid var(--line)',
      }}>
        <I.Inbox size={14} style={{ color: 'var(--accent)' }}/>
        <span className="mono" style={{ color: 'var(--fg)', fontSize: 13 }}>all notes</span>
        <span className="mono" style={{ color: 'var(--fg-4)', fontSize: 11 }}>{NOTES.length}</span>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 1, padding: 2, background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 6 }}>
          {['list', 'grid'].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{
                padding: '3px 9px', borderRadius: 4, fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: view === v ? 'var(--accent)' : 'var(--fg-2)',
                background: view === v ? 'var(--accent-soft)' : 'transparent',
              }}>{v}</button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{
            background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--fg-1)',
            borderRadius: 6, padding: '3px 8px', fontSize: 11.5, fontFamily: 'var(--font-mono)',
          }}>
          <option value="updated">sort: updated</option>
          <option value="title">sort: title</option>
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: view === 'grid' ? 16 : 0 }}>
        {view === 'list' ? (
          <div>
            {sorted.map((n, i) => (
              <button key={n.id} onClick={() => onSelect(n.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '20px 1fr auto auto auto',
                  gap: 12, alignItems: 'center', width: '100%',
                  padding: '11px 16px', borderBottom: '1px solid var(--line)',
                  textAlign: 'left', color: 'var(--fg-1)',
                  background: 'transparent',
                }}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--bg-hover)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';}}>
                {n.starred ? <I.StarOn size={12} style={{color:'var(--accent-warn)'}}/> : <I.FileText size={12} style={{color:'var(--fg-3)'}}/>}
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--fg)', fontSize: 13.5, fontWeight: 500, marginBottom: 2 }}>{n.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{n.path}</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {n.tags.slice(0, 3).map(t => (
                    <span key={t} className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', padding: '1px 5px', border: '1px solid var(--line)', borderRadius: 3 }}>#{t}</span>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', minWidth: 60, textAlign: 'right' }}>{n.words}w</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', minWidth: 110, textAlign: 'right' }}>
                  {new Date(n.updated).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {sorted.map(n => (
              <button key={n.id} onClick={() => onSelect(n.id)}
                style={{
                  textAlign: 'left', padding: 14, borderRadius: 8,
                  background: 'var(--bg-1)', border: '1px solid var(--line)',
                  display: 'flex', flexDirection: 'column', gap: 8, minHeight: 130,
                  color: 'var(--fg-1)',
                }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--line)';}}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {n.starred ? <I.StarOn size={11} style={{color:'var(--accent-warn)'}}/> : <I.FileText size={11} style={{color:'var(--fg-3)'}}/>}
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{n.path}</span>
                </div>
                <div style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{n.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>
                  {n.tags.slice(0, 3).map(t => (
                    <span key={t} className="mono" style={{ fontSize: 10, color: 'var(--accent)', padding: '1px 5px', background: 'var(--accent-soft)', borderRadius: 3 }}>#{t}</span>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>{n.words}w · updated {new Date(n.updated).toLocaleDateString()}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* Login screen */
function LoginScreen({ onSignIn }) {
  const [tab, setTab] = useScr1('signin');
  const [email, setEmail] = useScr1('');
  const [password, setPassword] = useScr1('');

  return (
    <div className="bg-grid" style={{
      flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', position: 'relative', overflow: 'hidden',
    }}>
      {/* glowy orb */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 60%)',
        top: -200, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'none',
      }}/>

      <div style={{ width: 380, position: 'relative', zIndex: 1 }}>
        {/* brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 32 }}>
          <I.Logo size={36}/>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--fg)', letterSpacing: -0.5 }}>kryton</span>
        </div>

        <div style={{
          background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 12,
          padding: 28, boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{ marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            // {tab === 'signin' ? 'authenticate' : 'register'}
          </div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--fg)', letterSpacing: -0.3, marginBottom: 24 }}>
            {tab === 'signin' ? 'Welcome back' : 'Create your account'}
          </h2>

          <div style={{ display: 'flex', gap: 0, marginBottom: 22, borderBottom: '1px solid var(--line)' }}>
            {['signin', 'register'].map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 12.5, fontFamily: 'var(--font-mono)',
                  color: tab === t ? 'var(--accent)' : 'var(--fg-3)',
                  borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{t}</button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="email" value={email} onChange={setEmail} placeholder="you@example.com" type="email"/>
            <Field label="password" value={password} onChange={setPassword} placeholder="••••••••••••" type="password"/>

            <button onClick={onSignIn}
              style={{
                marginTop: 6, padding: '10px 14px', borderRadius: 7,
                background: 'var(--accent)', color: 'var(--accent-fg)',
                fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 600,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              {tab === 'signin' ? 'sign in' : 'create account'}
              <I.Chevron size={12}/>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }}/>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>OR</span>
              <div style={{ flex: 1, height: 1, background: 'var(--line)' }}/>
            </div>

            <button style={{
              padding: '10px 14px', borderRadius: 7,
              background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--fg-1)',
              fontFamily: 'var(--font-mono)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <I.Sparkle size={13} style={{ color: 'var(--accent)' }}/>
              continue with passkey
            </button>
          </div>

          <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px dashed var(--line)', fontSize: 11.5, color: 'var(--fg-3)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
            self-hosted · your notes, your server
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 14, justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="dot pulse" style={{ background: 'var(--accent-good)' }}/> server online
          </span>
          <span>v0.4.2</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.06em' }}>{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          padding: '10px 12px', borderRadius: 6,
          background: 'var(--bg-input)', border: '1px solid var(--line)',
          color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-mono)', outline: 'none',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--line)'; e.target.style.boxShadow = 'none'; }}/>
    </label>
  );
}

window.AllNotesView = AllNotesView;
window.LoginScreen = LoginScreen;
