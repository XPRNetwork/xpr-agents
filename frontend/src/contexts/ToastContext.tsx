import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

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

const isMainnet = process.env.NEXT_PUBLIC_NETWORK === 'mainnet';
const EXPLORER_URL = isMainnet
  ? 'https://explorer.xprnetwork.org/transaction'
  : 'https://testnet.explorer.xprnetwork.org/transaction';

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

      {/* Toast container — bottom-right */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur-lg animate-slide-up ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/30'
                : toast.type === 'error'
                ? 'bg-red-950/90 border-red-500/30'
                : 'bg-zinc-900/90 border-zinc-700/50'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`shrink-0 mt-0.5 ${
                toast.type === 'success' ? 'text-emerald-400'
                  : toast.type === 'error' ? 'text-red-400'
                  : 'text-blue-400'
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
                    : 'text-zinc-200'
                }`}>
                  {toast.message}
                </p>
                {toast.txId && (
                  <a
                    href={`${EXPLORER_URL}/${toast.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-zinc-400 hover:text-white transition-colors group"
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
                className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
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
