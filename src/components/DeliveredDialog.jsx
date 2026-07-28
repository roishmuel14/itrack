import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';

// Local YYYY-MM-DD, never toISOString(): a parcel delivered at 9pm on the 3rd
// must not be logged as the 4th just because the browser sits east of UTC.
function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// "When did it arrive?" between the tap and the write. Defaults to today so the
// common case stays a two-tap action, with yesterday one tap away and the date
// field for anything older. The server revalidates all of this.
export default function DeliveredDialog({ order, open, busy = false, onConfirm, onClose }) {
  const today = localDay(0);
  const yesterday = localDay(-1);
  const [date, setDate] = useState(today);

  useEffect(() => {
    if (open) setDate(order?.delivered_at?.slice(0, 10) || localDay(0));
  }, [open, order?.id, order?.delivered_at]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || !order) return null;

  const minDate = order.ordered_at ? order.ordered_at.slice(0, 10) : undefined;
  const invalid = !date || date > today || (minDate && date < minDate);

  const submit = (e) => {
    e.preventDefault();
    if (invalid || busy) return;
    onConfirm?.(date);
  };

  const quick = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: yesterday },
  ].filter((q) => !minDate || q.value >= minDate);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Set the delivery date"
    >
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-card rounded-2xl card-shadow-hover border w-full max-w-sm p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-[hsl(var(--status-delivered))]" aria-hidden="true" />
            It arrived
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
        <p className="text-sm text-muted-foreground mb-4">
          When did the {order.merchant_name} order land?
        </p>

        <form onSubmit={submit}>
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {quick.map((q) => (
              <button
                key={q.value}
                type="button"
                onClick={() => setDate(q.value)}
                aria-pressed={date === q.value}
                className={`px-3 py-1.5 rounded-full font-mono text-[11px] font-semibold uppercase tracking-[0.1em] border transition-colors ${
                  date === q.value
                    ? 'bg-foreground text-background border-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Delivery date
            </span>
            <Input
              type="date"
              value={date}
              max={today}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1.5 h-11"
              required
            />
          </label>
          {minDate && date && date < minDate && (
            <p className="text-xs text-[hsl(var(--status-overdue))] mt-2">
              This order was placed on {formatDate(minDate)}.
            </p>
          )}

          <div className="flex items-center gap-2 mt-5">
            <Button type="button" variant="ghost" className="flex-1 h-11 rounded-xl" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 h-11 rounded-xl" disabled={busy || invalid}>
              {busy ? 'Saving...' : 'Mark delivered'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
