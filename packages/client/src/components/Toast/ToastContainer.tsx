import { useEffect, useRef, useState } from 'react';
import { X, Info, CheckCircle, AlertCircle } from 'lucide-react';
import { useToastStore, Toast } from '../../stores/toastStore';

const TYPE_STYLES: Record<Toast['type'], { border: string; icon: string; Icon: React.ElementType }> = {
  info: {
    border: 'border-blue-500',
    icon: 'text-blue-500',
    Icon: Info,
  },
  success: {
    border: 'border-green-500',
    icon: 'text-green-500',
    Icon: CheckCircle,
  },
  error: {
    border: 'border-red-500',
    icon: 'text-red-500',
    Icon: AlertCircle,
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);

  // Trigger enter animation on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss after duration
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setVisible(false);
      // Allow exit animation to complete before removing
      setTimeout(() => removeToast(toast.id), 300);
    }, toast.duration);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, removeToast]);

  const handleDismiss = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(() => removeToast(toast.id), 300);
  };

  const { border, icon, Icon } = TYPE_STYLES[toast.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{ maxWidth: '320px' }}
      className={[
        'w-full flex items-start gap-3 rounded-lg shadow-lg',
        'bg-surface-900 dark:bg-surface-800 border-l-4',
        border,
        'px-3 py-3',
        'transition-all duration-300 ease-out',
        visible
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 translate-x-4',
      ].join(' ')}
    >
      <Icon size={18} className={`shrink-0 mt-0.5 ${icon}`} />
      <span className="flex-1 text-sm text-gray-100 leading-snug break-words">
        {toast.message}
      </span>
      <button
        onClick={handleDismiss}
        className="shrink-0 text-gray-400 hover:text-gray-100 rounded p-0.5 transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
