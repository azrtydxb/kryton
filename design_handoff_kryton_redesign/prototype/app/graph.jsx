/* global React, I */
const { useState: useG1, useEffect: useG2, useRef: useG3 } = React;

function GraphPanel({ activeId, onSelect, mode = 'local', onModeChange, fullscreen }) {
  const { GRAPH, NOTES } = window.K_DATA;
  const noteById = (id) => NOTES.find(n => n.id === id);

  const [hover, setHover] = useG1(null);
  const [zoom, setZoom] = useG1(1);

  const W = fullscreen ? 1200 : 360;
  const H = fullscreen ? 800 : 360;

  const visibleNodes = mode === 'local' && activeId
    ? GRAPH.nodes.filter(n => n.id === activeId || GRAPH.edges.some(([a, b]) => (a === activeId && b === n.id) || (b === activeId && a === n.id)))
    : GRAPH.nodes;
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = GRAPH.edges.filter(([a, b]) => visibleIds.has(a) && visibleIds.has(b));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-1)', borderLeft: fullscreen ? 'none' : '1px solid var(--line)',
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        height: 38, padding: '0 12px', borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        <I.Network size={13} style={{ color: 'var(--accent)' }}/>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>graph</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-4)' }}>{visibleNodes.length}n {visibleEdges.length}e</span>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', gap: 1, padding: 2, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6 }}>
          {['local', 'global'].map(m => (
            <button key={m} onClick={() => onModeChange?.(m)}
              style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: mode === m ? 'var(--accent)' : 'var(--fg-2)',
                background: mode === m ? 'var(--accent-soft)' : 'transparent',
              }}>{m}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }} className="bg-grid">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
             style={{ width: '100%', height: '100%' }}
             onMouseLeave={() => setHover(null)}>
          {/* faint connectors of all edges (ghosted in local mode) */}
          {mode === 'local' && GRAPH.edges
            .filter(([a, b]) => !visibleIds.has(a) || !visibleIds.has(b))
            .map(([a, b], i) => {
              const na = GRAPH.nodes.find(n => n.id === a);
              const nb = GRAPH.nodes.find(n => n.id === b);
              if (!na || !nb) return null;
              return <line key={'g' + i} x1={na.x*W} y1={na.y*H} x2={nb.x*W} y2={nb.y*H}
                stroke="var(--line)" strokeWidth="1" opacity="0.3"/>;
            })}

          {/* edges */}
          {visibleEdges.map(([a, b], i) => {
            const na = GRAPH.nodes.find(n => n.id === a);
            const nb = GRAPH.nodes.find(n => n.id === b);
            const active = activeId === a || activeId === b;
            const hovered = hover === a || hover === b;
            return (
              <line key={i} x1={na.x*W} y1={na.y*H} x2={nb.x*W} y2={nb.y*H}
                stroke={active || hovered ? 'var(--accent)' : 'var(--fg-4)'}
                strokeWidth={active || hovered ? 1.5 : 1}
                opacity={active || hovered ? 0.9 : 0.5}/>
            );
          })}

          {/* faded nodes outside local set */}
          {mode === 'local' && GRAPH.nodes.filter(n => !visibleIds.has(n.id)).map(n => (
            <circle key={'gn' + n.id} cx={n.x*W} cy={n.y*H} r={n.r * 0.6}
              fill="var(--fg-4)" opacity="0.25"/>
          ))}

          {/* visible nodes */}
          {visibleNodes.map(n => {
            const active = activeId === n.id;
            const hovered = hover === n.id;
            return (
              <g key={n.id} style={{ cursor: 'pointer' }}
                 onMouseEnter={() => setHover(n.id)}
                 onClick={() => onSelect?.(n.id)}>
                {(active || hovered) && (
                  <circle cx={n.x*W} cy={n.y*H} r={n.r + 6}
                    fill="var(--accent)" opacity="0.18"/>
                )}
                <circle cx={n.x*W} cy={n.y*H} r={n.r}
                  fill={active ? 'var(--accent)' : 'var(--bg-2)'}
                  stroke={active || hovered ? 'var(--accent)' : 'var(--fg-3)'}
                  strokeWidth={active ? 2 : 1.2}/>
                {(hovered || active || fullscreen) && (
                  <text x={n.x*W} y={n.y*H + n.r + 14} textAnchor="middle"
                        fill={active ? 'var(--accent)' : 'var(--fg-1)'}
                        fontSize={fullscreen ? 13 : 11}
                        fontFamily="var(--font-sans)">
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* mini-info card */}
        {hover && (() => {
          const n = noteById(hover) || { title: GRAPH.nodes.find(x=>x.id===hover)?.label };
          return (
            <div style={{
              position: 'absolute', left: 12, bottom: 12, padding: '8px 10px',
              background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6,
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-1)',
              boxShadow: 'var(--shadow-md)', maxWidth: 280,
            }}>
              <div style={{ color: 'var(--fg)', fontSize: 12, marginBottom: 2 }}>{n.title}</div>
              <div style={{ color: 'var(--fg-3)' }}>{n.path || ''}</div>
            </div>
          );
        })()}

        {/* corner controls */}
        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GfxBtn title="Center"><I.Crosshair size={12}/></GfxBtn>
          <GfxBtn title="Zoom in"><I.Plus size={12}/></GfxBtn>
          <GfxBtn title="Zoom out"><I.X size={12} style={{transform:'rotate(45deg)'}}/></GfxBtn>
        </div>
      </div>

      {/* legend */}
      <div style={{
        height: 28, padding: '0 12px', borderTop: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--fg-3)',
      }}>
        <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:8, height:8, borderRadius:'50%', background:'var(--accent)' }}/>active</span>
        <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:8, height:8, borderRadius:'50%', background:'var(--bg-2)', border:'1px solid var(--fg-3)' }}/>note</span>
        <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:14, height:1, background:'var(--accent)' }}/>link</span>
        <div style={{ flex: 1 }}/>
        <span>{Math.round(zoom*100)}%</span>
      </div>
    </div>
  );
}

function GfxBtn({ children, title }) {
  return (
    <button title={title}
      style={{
        width: 26, height: 26, borderRadius: 5,
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        color: 'var(--fg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={e=>{e.currentTarget.style.color='var(--accent)'; e.currentTarget.style.borderColor='var(--accent)';}}
      onMouseLeave={e=>{e.currentTarget.style.color='var(--fg-2)'; e.currentTarget.style.borderColor='var(--line)';}}
    >{children}</button>
  );
}

window.GraphPanel = GraphPanel;
