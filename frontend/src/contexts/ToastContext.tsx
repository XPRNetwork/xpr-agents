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

      {/* Toast container — full-width inset on mobile, bottom-right on desktop.
          Never wider than the viewport: left-4/right-4 bound it on small screens
          and max-w-sm caps it once there is room. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 left-4 right-4 z-[100] mx-auto flex max-w-sm flex-col gap-2 md:left-auto md:right-4 md:mx-0 md:w-full"
      >
        {toasts.map(toast => (
          <div
            key={toast.id}
            role="status"
            className="animate-slide-up pointer-events-auto rounded-lg border border-line bg-canvas px-4 py-3 shadow-lg shadow-ink/10"
          >
            <div className="flex items-start gap-3">
              {/* Icon — the only place the tone colour is used, so it always
                  sits on the neutral canvas and stays legible in both themes. */}
              <div
                aria-hidden="true"
                className={`mt-0.5 shrink-0 ${
                  toast.type === 'success'
                    ? 'text-good'
                    : toast.type === 'error'
                    ? 'text-crit'
                    : 'text-info'
                }`}
              >
                {toast.type === 'success' ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : toast.type === 'error' ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-ink">{toast.message}</p>
                {toast.txId && (
                  <a
                    href={`${getExplorerTxUrl()}/${toast.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mt-1.5 inline-flex max-w-full items-center gap-1.5 text-xs text-ink-2 transition-colors hover:text-ink"
                  >
                    <span className="truncate font-mono">{toast.txId.slice(0, 8)}&hellip;</span>
                    <svg className="h-3.5 w-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>

              {/* Dismiss */}
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => removeToast(toast.id)}
                className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
