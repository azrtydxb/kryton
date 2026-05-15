import * as React from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "../primitives/button";

export interface DiagnosticsError {
  id: string;
  message: string;
  occurredAt?: string | null;
}

export interface DiagnosticsPanelProps {
  syncState?: Record<string, unknown> | null;
  recentErrors?: DiagnosticsError[];
  onCopyReport?: () => void;
}

export function DiagnosticsPanel({
  syncState,
  recentErrors = [],
  onCopyReport,
}: DiagnosticsPanelProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopyReport = async () => {
    const report = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        syncState: syncState ?? null,
        recentErrors,
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
    onCopyReport?.();
  };

  return (
    <div className="space-y-8 max-w-lg">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Diagnostics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Sync state and recent error log.
        </p>
      </div>

      {/* Sync state */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Sync state</h3>
        <pre className="max-h-48 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          {syncState !== null && syncState !== undefined
            ? JSON.stringify(syncState, null, 2)
            : "No sync state available."}
        </pre>
      </section>

      {/* Recent errors */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Recent errors</h3>
        {recentErrors.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No recent errors.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Recent errors">
            {recentErrors.map((err) => (
              <li
                key={err.id}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800/50 dark:bg-red-900/20"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-red-700 dark:text-red-400 break-words flex-1">
                    {err.message}
                  </p>
                  {err.occurredAt && (
                    <span className="shrink-0 text-[10px] text-red-400 dark:text-red-500">
                      {new Date(err.occurredAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Copy report */}
      <section>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyReport}
          aria-label="Copy diagnostics report to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy report to clipboard
            </>
          )}
        </Button>
      </section>
    </div>
  );
}
