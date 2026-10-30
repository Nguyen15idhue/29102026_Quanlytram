import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-3), { id, kind, message }]);
      window.setTimeout(() => remove(id), 4500);
    },
    [remove]
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {items.map((item) => {
          const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? XCircle : Info;
          return (
            <div key={item.id} className={`toast ${item.kind}`} role="status">
              <Icon size={18} aria-hidden="true" />
              <span>{item.message}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Đóng thông báo"
                onClick={() => remove(item.id)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used within ToastProvider');
  return value;
}
