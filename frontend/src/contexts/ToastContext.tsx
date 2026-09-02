import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { getNetworkConfig } from '../lib/networks';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  txId?: string;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

function getExplorerTxUrl() {
  return `${getNetworkConfig().explorer}/transaction`;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++nextId;
    setToasts(prev => [...prev, { ...toast, id }]);
    // Auto-dismiss after 8s for success/info, 12s for errors
    const delay = toast.type === 'error' ? 12000 : 8000;
    setTimeout(() => removeToast(id), delay);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}

      {/* Toast container — centered on mobile, bottom-right on desktop */}
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 z-[100] flex flex-col gap-2 max-w-sm mx-auto md:mx-0 md:w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl shadow-ink/10 backdrop-blur-lg animate-slide-up ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-200'
                : toast.type === 'error'
                ? 'bg-red-950/90 border-red-200'
                : 'bg-surface/90 border-line-2/50'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`shrink-0 mt-0.5 ${
                toast.type === 'success' ? 'text-emerald-600'
                  : toast.type === 'error' ? 'text-red-600'
                  : 'text-blue-600'
              }`}>
                {toast.type === 'success' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : toast.type === 'error' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  toast.type === 'success' ? 'text-emerald-200'
                    : toast.type === 'error' ? 'text-red-200'
                    : 'text-ink-2'
                }`}>
                  {toast.message}
                </p>
                {toast.txId && (
                  <a
                    href={`${getExplorerTxUrl()}/${toast.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-ink-2 hover:text-ink transition-colors group"
                  >
                    <span className="font-mono">{toast.txId.slice(0, 8)}&hellip;</span>
                    <svg className="w-3.5 h-3.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>

              {/* Dismiss */}
              <button
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-muted hover:text-ink-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
