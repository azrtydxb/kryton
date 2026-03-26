import { useEffect, useRef } from 'react';
import { useToastStore } from '../../stores/toastStore';

interface ErrorToastProps {
  message: string | null;
  onDismiss: () => void;
}

/**
 * Bridges legacy error-prop usage into the toast store.
 * When `message` changes to a non-null value, it fires an error toast.
 * The `onDismiss` callback is called after the toast is added so callers
 * can clear their error state immediately (the toast store owns display lifetime).
 */
export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  const addToast = useToastStore((s) => s.addToast);
  const lastMessage = useRef<string | null>(null);

  useEffect(() => {
    if (message && message !== lastMessage.current) {
      lastMessage.current = message;
      addToast('error', message);
      onDismiss();
    }
  }, [message, addToast, onDismiss]);

  return null;
}
