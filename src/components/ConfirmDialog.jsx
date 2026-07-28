import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// One modal for "are you sure" moments. Destructive by default because that is
// the only kind we have so far; the confirm button never auto-focuses, so a
// stray Enter cannot delete anything.
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting...',
  busy = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-card rounded-2xl card-shadow-hover border w-full max-w-sm p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-[hsl(var(--status-overdue))]" aria-hidden="true" />
            {title}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex items-center gap-2 mt-5">
          <Button type="button" variant="ghost" className="flex-1 h-11 rounded-xl" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1 h-11 rounded-xl"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
