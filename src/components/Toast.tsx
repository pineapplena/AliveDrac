import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastState {
  id: number;
  kind: ToastKind;
  message: string;
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, toast.kind === 'error' ? 5200 : 3200);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;
  const Icon = toast.kind === 'error' ? AlertCircle : toast.kind === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <Icon size={17} />
      <span>{toast.message}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={14} />
      </button>
    </div>
  );
}
