import * as React from "react";
import { cn } from "../lib/utils";
import { Resizer } from "../primitives/resizer";

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 600;
const PANEL_MIN = 160;
const PANEL_MAX = 600;
const DEFAULT_SIDEBAR = 240;
const DEFAULT_PANEL = 280;

export interface ThreePanelLayoutProps {
  /** localStorage key prefix used to persist sidebar/panel widths. */
  storageKey?: string;
  /** Left sidebar content. */
  sidebar?: React.ReactNode;
  /** Main content area. */
  children?: React.ReactNode;
  /** Right panel content. Hidden when not provided. */
  panel?: React.ReactNode;
  /** Whether the left sidebar is visible. */
  sidebarOpen?: boolean;
  /** Whether the right panel is visible. */
  panelOpen?: boolean;
  className?: string;
}

function readWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // localStorage may be unavailable in SSR
  }
  return fallback;
}

function writeWidth(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

/**
 * ThreePanelLayout — resizable three-column layout.
 *
 * Left sidebar | main content | right panel
 *
 * Widths are persisted to localStorage via `storageKey`.
 */
export function ThreePanelLayout({
  storageKey = "kryton-layout",
  sidebar,
  children,
  panel,
  sidebarOpen = true,
  panelOpen = true,
  className,
}: ThreePanelLayoutProps) {
  const sidebarKey = `${storageKey}:sidebar-width`;
  const panelKey = `${storageKey}:panel-width`;

  const [sidebarWidth, setSidebarWidth] = React.useState(() =>
    readWidth(sidebarKey, DEFAULT_SIDEBAR),
  );
  const [panelWidth, setPanelWidth] = React.useState(() =>
    readWidth(panelKey, DEFAULT_PANEL),
  );

  const handleSidebarResize = React.useCallback(
    (delta: number) => {
      setSidebarWidth((prev) => {
        const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, prev + delta));
        writeWidth(sidebarKey, next);
        return next;
      });
    },
    [sidebarKey],
  );

  const handlePanelResize = React.useCallback(
    (delta: number) => {
      setPanelWidth((prev) => {
        // right panel grows leftward: negative delta = narrower
        const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, prev - delta));
        writeWidth(panelKey, next);
        return next;
      });
    },
    [panelKey],
  );

  return (
    <div className={cn("flex h-full w-full overflow-hidden", className)}>
      {/* Left sidebar */}
      {sidebar && sidebarOpen && (
        <>
          <aside
            className="flex shrink-0 flex-col overflow-hidden border-r bg-gray-50 dark:bg-surface-900"
            style={{ width: sidebarWidth }}
          >
            {sidebar}
          </aside>
          <Resizer
            orientation="horizontal"
            onResize={handleSidebarResize}
            minSize={SIDEBAR_MIN}
            maxSize={SIDEBAR_MAX}
          />
        </>
      )}

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>

      {/* Right panel */}
      {panel && panelOpen && (
        <>
          <Resizer
            orientation="horizontal"
            onResize={handlePanelResize}
            minSize={PANEL_MIN}
            maxSize={PANEL_MAX}
          />
          <aside
            className="flex shrink-0 flex-col overflow-hidden border-l bg-gray-50 dark:bg-surface-900"
            style={{ width: panelWidth }}
          >
            {panel}
          </aside>
        </>
      )}
    </div>
  );
}
