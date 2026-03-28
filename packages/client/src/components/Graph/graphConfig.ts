export const GRAPH_CONFIG = {
  simulation: {
    // Global mode (tuned force-directed)
    global: {
      linkDistance: 150,
      chargeStrength: -400,
      collisionRadius: 40,
      activeRadialStrength: 0.1, // soft pull toward center
    },
    // Local mode (concentric rings)
    local: {
      linkDistance: 80,
      chargeStrength: -300,
      collisionRadius: 35,
      ring1Ratio: 0.3, // inner ring at 30% of min(width,height)
      ring2Ratio: 0.6, // outer ring at 60% of min(width,height)
      radialStrength: 0.8, // how tightly nodes stick to their ring
    },
    dragAlphaTarget: 0.3,
    resizeAlpha: 0.3,
    transitionAlpha: 0.5, // alpha reheat on mode switch
  },
  zoom: {
    scaleMin: 0.2,
    scaleMax: 5,
    recenterDuration: 300,
  },
  node: {
    activeRadius: 10,
    hoveredRadius: 8,
    defaultRadius: 6,
    starHoveredRadius: 9,
    starDefaultRadius: 7,
    starInnerRadiusRatio: 0.4,
    labelOffset: 4,
    hitTestRadiusSq: 100,
  },
  font: {
    activeSize: 12,
    defaultSize: 11,
    family: 'Inter, system-ui, sans-serif',
  },
  label: {
    maxLength: 20,
    truncatedLength: 18,
    ellipsis: '...',
  },
  colors: {
    light: {
      link: 'rgba(148, 163, 184, 0.4)',
      node: '#7c3aed',
      nodeHovered: '#7c3aed',
      nodeActive: '#25D366',
      nodeShared: '#f97316',
      strokeActive: '#128C7E',
      strokeShared: '#ea580c',
      strokeHovered: '#6d28d9',
      label: '#334155',
      star: '#eab308',
      starStroke: '#ca8a04',
    },
    dark: {
      link: 'rgba(100, 116, 139, 0.3)',
      node: '#a78bfa',
      nodeHovered: '#7c3aed',
      nodeActive: '#25D366',
      nodeShared: '#f97316',
      strokeActive: '#128C7E',
      strokeShared: '#ea580c',
      strokeHovered: '#c4b5fd',
      label: '#e2e8f0',
      star: '#eab308',
      starStroke: '#ca8a04',
    },
  },
} as const;
