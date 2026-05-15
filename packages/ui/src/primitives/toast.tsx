/**
 * Toast — thin re-export from `sonner` with an opinionated <Toaster> default.
 *
 * Usage:
 *   // In app root:
 *   import { Toaster } from "@azrtydxb/ui"
 *   <Toaster />
 *
 *   // Anywhere:
 *   import { toast } from "@azrtydxb/ui"
 *   toast.success("Saved!")
 */
export { toast } from "sonner";

import * as React from "react";
import { Toaster as SonnerToasterPrimitive, type ToasterProps as SonnerToasterProps } from "sonner";

export type { SonnerToasterProps };

export type ToasterProps = SonnerToasterProps;

/**
 * Pre-styled Toaster that matches the Kryton design system.
 * Drop into your app root — typically alongside ThemeProvider.
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <SonnerToasterPrimitive
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-950 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-50",
          description: "text-gray-500 dark:text-gray-400",
          actionButton:
            "rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700",
          cancelButton:
            "rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300",
          closeButton:
            "ml-auto opacity-50 hover:opacity-100 focus:ring-2 focus:ring-violet-500",
          error:
            "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300",
          success:
            "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300",
          warning:
            "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300",
          info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300",
        },
      }}
      {...props}
    />
  );
}
