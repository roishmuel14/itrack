import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

// Tiny dependency-free toaster. Failures map the server's reasons[] messages
// verbatim (PRD section 10 global states).
const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    ({ title, description, tone = 'info', durationMs = 5000 }) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, title, description, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), durationMs),
      );
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (title, description) => push({ title, description, tone: 'success' }),
      info: (title, description) => push({ title, description, tone: 'info' }),
      error: (title, description) => push({ title, description, tone: 'error', durationMs: 8000 }),
      // The single error chokepoint: FunctionError reasons become the body.
      notifyError: (err, fallbackTitle = 'Something went wrong') => {
        const reasons = err?.reasons?.length
          ? err.reasons.map((r) => r.message).join('\n')
          : err?.message || 'Try again.';
        push({ title: err?.reasons?.length ? err.message : fallbackTitle, description: reasons, tone: 'error', durationMs: 8000 });
      },
    }),
    [push],
  );

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-[hsl(var(--status-delivered))]" />,
    error: <AlertTriangle className="w-5 h-5 text-[hsl(var(--status-overdue))]" />,
    info: <Info className="w-5 h-5 text-primary" />,
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[100] flex flex-col gap-2 sm:w-96" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="bg-card rounded-2xl card-shadow-hover border p-4 flex gap-3 items-start">
            {icons[t.tone] ?? icons.info}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{t.title}</p>
              {t.description && (
                <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-line break-words">{t.description}</p>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
