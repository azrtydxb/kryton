/* eslint-disable react-refresh/only-export-components */
/**
 * Inline SVG icon set — lifted from the design handoff prototype
 * (`design_handoff_kryton_redesign/prototype/app/icons.jsx`). Same names,
 * same visual style (lucide-flavoured stroke 1.5, currentColor).
 *
 * Why not lucide-react directly? Some glyphs in the prototype are
 * custom (the K logomark) or stroke-tweaked. Keeping a single source
 * of truth here makes the redesign pixel-stable.
 *
 * The file exports a const-of-components plus a type alias by design;
 * react-refresh's "only components" check is disabled at the file level.
 */
import type { CSSProperties, ReactNode } from "react";

interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
}

interface IconBaseProps extends IconProps {
  d?: string;
  children?: ReactNode;
}

function IconBase({
  d,
  size = 14,
  stroke = 1.5,
  fill = "none",
  style,
  className,
  children,
}: IconBaseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const Icons = {
  Search: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </IconBase>
  ),
  Plus: (p: IconProps) => <IconBase {...p} d="M12 5v14M5 12h14" />,
  FolderPlus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M12 11v6M9 14h6" />
    </IconBase>
  ),
  Folder: (p: IconProps) => (
    <IconBase
      {...p}
      d="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"
    />
  ),
  FolderOpen: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2" />
      <path d="M3 10h18l-2.2 8a2 2 0 0 1-2 1.4H5.2a2 2 0 0 1-2-1.4z" />
    </IconBase>
  ),
  Chevron: (p: IconProps) => <IconBase {...p} d="m9 6 6 6-6 6" />,
  ChevronD: (p: IconProps) => <IconBase {...p} d="m6 9 6 6 6-6" />,
  File: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </IconBase>
  ),
  FileText: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </IconBase>
  ),
  Star: (p: IconProps) => (
    <IconBase
      {...p}
      d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.3 9.4l6-.9z"
    />
  ),
  StarOn: (p: IconProps) => (
    <IconBase
      {...p}
      fill="currentColor"
      d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.3 9.4l6-.9z"
    />
  ),
  Tag: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
      <circle cx="8" cy="8" r="1.5" />
    </IconBase>
  ),
  Hash: (p: IconProps) => (
    <IconBase {...p} d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  ),
  Calendar: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </IconBase>
  ),
  Layout: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </IconBase>
  ),
  PanelLeft: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </IconBase>
  ),
  PanelRight: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
    </IconBase>
  ),
  Network: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M12 7v3M12 10 5.5 17M12 10l6.5 7" />
    </IconBase>
  ),
  Eye: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  ),
  Edit: (p: IconProps) => (
    <IconBase {...p} d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
  ),
  Save: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </IconBase>
  ),
  Settings: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </IconBase>
  ),
  Command: (p: IconProps) => (
    <IconBase
      {...p}
      d="M18 3a3 3 0 0 0 0 6h-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v3H6a3 3 0 1 0 3 3V9h6v3a3 3 0 1 0 3-3"
    />
  ),
  Sun: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M5 5l1.5 1.5M17.5 17.5 19 19M2 12h2M20 12h2M5 19l1.5-1.5M17.5 6.5 19 5" />
    </IconBase>
  ),
  Moon: (p: IconProps) => (
    <IconBase {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  ),
  Sparkle: (p: IconProps) => (
    <IconBase
      {...p}
      d="M12 3v6M12 15v6M3 12h6M15 12h6M5.5 5.5 9 9M15 15l3.5 3.5M5.5 18.5 9 15M15 9l3.5-3.5"
    />
  ),
  Zap: (p: IconProps) => <IconBase {...p} d="M13 2 3 14h7l-1 8 10-12h-7z" />,
  Bot: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4M9 4h6" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
    </IconBase>
  ),
  Link: (p: IconProps) => (
    <IconBase
      {...p}
      d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1-1"
    />
  ),
  Share: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </IconBase>
  ),
  History: (p: IconProps) => (
    <IconBase {...p} d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
  ),
  Download: (p: IconProps) => (
    <IconBase {...p} d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  ),
  More: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </IconBase>
  ),
  X: (p: IconProps) => <IconBase {...p} d="M18 6 6 18M6 6l12 12" />,
  Check: (p: IconProps) => <IconBase {...p} d="m5 13 4 4L19 7" />,
  Trash: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" />
    </IconBase>
  ),
  Crosshair: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </IconBase>
  ),
  Filter: (p: IconProps) => (
    <IconBase {...p} d="M3 4h18l-7 9v6l-4 2v-8z" />
  ),
  ArrowUp: (p: IconProps) => <IconBase {...p} d="M12 19V5M5 12l7-7 7 7" />,
  ArrowDown: (p: IconProps) => <IconBase {...p} d="M12 5v14M5 12l7 7 7-7" />,
  Inbox: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </IconBase>
  ),
  Menu: (p: IconProps) => <IconBase {...p} d="M3 6h18M3 12h18M3 18h18" />,
  /**
   * Kryton wordmark/logo glyph — the K-mark from the brand pack.
   * Sized via `size` prop. Uses brand gradient (violet → orange).
   */
  Logo: ({ size = 24, className, style }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="kg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="url(#kg)"
        strokeWidth="1.5"
        opacity="0.7"
      />
      <path
        d="M22 16 L22 48 M22 32 L42 16 M22 32 L42 48"
        stroke="url(#kg)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="32" cy="32" r="3" fill="#fb923c" />
    </svg>
  ),
} as const;

export type IconName = keyof typeof Icons;
