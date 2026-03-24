import { X } from 'lucide-react';

interface ErrorToastProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  return (
    <div className="fixed bottom-10 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-in slide-in-from-bottom">
      <span className="text-sm">{message}</span>
      <button onClick={onDismiss} className="hover:bg-red-600 rounded p-0.5">
        <X size={14} />
      </button>
    </div>
  );
}
