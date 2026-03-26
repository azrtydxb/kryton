import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error';
  message: string;
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  addToast: (type, message, duration = DEFAULT_DURATION) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, type, message, duration };
    const current = get().toasts;
    const updated = [...current, toast];
    // Drop oldest entries if we exceed the maximum
    const trimmed = updated.length > MAX_TOASTS ? updated.slice(updated.length - MAX_TOASTS) : updated;
    set({ toasts: trimmed });
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
