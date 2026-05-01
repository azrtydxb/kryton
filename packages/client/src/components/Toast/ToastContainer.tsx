import { useEffect, useRef } from 'react';
import { Toaster, toast as sonnerToast } from '@azrtydxb/ui';
import { useToastStore, Toast } from '../../stores/toastStore';

/**
 * Renders @azrtydxb/ui's Toaster (sonner) and bridges the client's toastStore
 * so that existing calls to `addToast` continue to work.
 *
 * Whenever a new toast is added to the store, it is forwarded to sonner's
 * imperative API and immediately removed from the store — sonner owns the
 * display lifecycle from that point.
 */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const t of toasts) {
      if (seenIds.current.has(t.id)) continue;
      seenIds.current.add(t.id);
      fireToast(t);
      removeToast(t.id);
    }
  }, [toasts, removeToast]);

  return <Toaster />;
}

function fireToast(t: Toast): void {
  const opts = { duration: t.duration, id: t.id };
  switch (t.type) {
    case 'error':
      sonnerToast.error(t.message, opts);
      break;
    case 'success':
      sonnerToast.success(t.message, opts);
      break;
    default:
      sonnerToast(t.message, opts);
  }
}
