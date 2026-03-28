export const GRAPH_CONFIG = {
  simulation: {
    // Global mode (tuned force-directed)
    global: {
      linkDistance: 150,
      chargeStrength: -400,
      collisionRadius: 40,
      activeRadialStrength: 0.08,
    },
    // Local mode (concentric rings)
    local: {
      linkDistance: 60,
      chargeStrength: -150,
      collisionRadius: 25,
      ring1Ratio: 0.3,
      ring2Ratio: 0.55,
      radialStrength: 1.2,
    },
    // Shared physics tuning
    alphaDecay: 0.008,     // slower cooldown (default 0.0228) — smooth settling
    alphaDecayLargeGraph: 0.02, // faster for 300+ nodes to reduce CPU
    largeGraphThreshold: 300,
    velocityDecay: 0.4,    // default damping
    dragAlphaTarget: 0.1,
    resizeAlpha: 0.2,
  },
  zoom: {
    scaleMin: 0.2,
    scaleMax: 5,
    recenterDuration: 500,
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
