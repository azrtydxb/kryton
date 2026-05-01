import * as React from "react";
import { cn } from "../lib/utils";

export interface AppShellProps {
  /** Top navigation bar. */
  header?: React.ReactNode;
  /** Left navigation/sidebar. */
  sidebar?: React.ReactNode;
  /** Right auxiliary panel. */
  panel?: React.ReactNode;
  /** Main content area. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * AppShell — full-viewport shell with named layout slots.
 *
 * ```
 * ┌──────────────────────────────────┐
 * │           header slot            │
 * ├────────┬─────────────────┬───────┤
 * │        │                 │       │
 * │sidebar │    children     │ panel │
 * │        │                 │       │
 * └────────┴─────────────────┴───────┘
 * ```
 *
 * All slots are optional. The shell takes the full viewport height via
 * `h-screen` and uses flex to fill remaining space.
 */
export function AppShell({ header, sidebar, panel, children, className }: AppShellProps) {
  return (
    <div className={cn("flex h-screen w-full flex-col overflow-hidden", className)}>
      {header && (
        <header className="flex shrink-0 items-center border-b bg-white dark:bg-surface-950">
          {header}
        </header>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar && (
          <nav className="flex shrink-0 flex-col border-r bg-gray-50 dark:bg-surface-900">
            {sidebar}
          </nav>
        )}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        {panel && (
          <aside className="flex shrink-0 flex-col border-l bg-gray-50 dark:bg-surface-900">
            {panel}
          </aside>
        )}
      </div>
    </div>
  );
}
