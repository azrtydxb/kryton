import * as React from "react";
import { cn } from "../lib/utils";

type ResizerOrientation = "horizontal" | "vertical";

interface ResizerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * "horizontal" = drag left/right to resize columns (default)
   * "vertical"   = drag up/down to resize rows
   */
  orientation?: ResizerOrientation;
  /**
   * Called continuously while dragging with the delta in pixels.
   * Positive delta = moved right/down.
   */
  onResize?: (delta: number) => void;
  /** Minimum target width/height the panel may reach (px). */
  minSize?: number;
  /** Maximum target width/height the panel may reach (px). */
  maxSize?: number;
}

/**
 * Resizer — drag handle for ThreePanelLayout.
 *
 * Not a shadcn component; custom implementation.
 *
 * Renders a thin bar with a visible grip indicator.
 * Consumers control the actual panel size; this component only emits delta px.
 */
const Resizer = React.forwardRef<HTMLDivElement, ResizerProps>(
  (
    {
      className,
      orientation = "horizontal",
      onResize,
      minSize: _minSize,
      maxSize: _maxSize,
      ...props
    },
    ref,
  ) => {
    const isHorizontal = orientation === "horizontal";

    const handleMouseDown = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startPos = isHorizontal ? e.clientX : e.clientY;

        const handleMouseMove = (ev: MouseEvent) => {
          const currentPos = isHorizontal ? ev.clientX : ev.clientY;
          onResize?.(currentPos - startPos);
        };

        const handleMouseUp = () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      },
      [isHorizontal, onResize],
    );

    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={orientation}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        className={cn(
          "group relative flex shrink-0 items-center justify-center bg-transparent transition-colors hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          isHorizontal
            ? "h-full w-1.5 cursor-col-resize"
            : "h-1.5 w-full cursor-row-resize",
          className,
        )}
        {...props}
      >
        {/* Grip dots */}
        <div
          className={cn(
            "flex gap-0.5 opacity-30 group-hover:opacity-70 transition-opacity",
            isHorizontal ? "flex-col" : "flex-row",
          )}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-1 w-1 rounded-full bg-gray-500 dark:bg-gray-400"
            />
          ))}
        </div>
      </div>
    );
  },
);
Resizer.displayName = "Resizer";

export { Resizer };
export type { ResizerProps, ResizerOrientation };
