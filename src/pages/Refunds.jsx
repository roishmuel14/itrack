import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ReceiptText, RefreshCw } from 'lucide-react';
import { Order, RefundOpportunity } from '@/api/entities';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import RefundCase from '@/components/refunds/RefundCase';

const URGENT_DEADLINE_DAYS = 14;

function daysUntilDate(iso) {
  if (!iso) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((target - start) / 86400000);
}

// Hoisted out of Refunds so its identity is stable across renders: an inline
// function component here would remount every RefundCase (losing draft/picker
// toggle state) whenever an unrelated action reloads the list.
function Section({ title, items, ordersById, onAct, busyId, onPaymentMethodSet }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-4 mb-8">
      {title && <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">{title}</h2>}
      {items.map((opp) => (
        <RefundCase
          key={opp.id}
          opportunity={opp}
          order={ordersById[opp.order_id]}
          onAct={onAct}
          busy={busyId === opp.id}
          onPaymentMethodSet={onPaymentMethodSet}
        />
      ))}
    </div>
  );
}

export default function Refunds() {
  const toast = useToast();
  const [opps, setOpps] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setOpps(null);
    try {
      const [r, o] = await Promise.all([
        RefundOpportunity.list('-created_date', 200),
        Order.list('-last_event_at', 500),
      ]);
      setOpps(r);
      setOrders(o);
    } catch (err) {
      console.error(err);
      setError(true);
      setOpps([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ordersById = useMemo(() => {
    const m = {};
    for (const o of orders) m[o.id] = o;
    return m;
  }, [orders]);

  const act = async (id, status) => {
    setBusyId(id);
    try {
      await invokeFunction('refunds/updateStatus', { opportunity_id: id, status });
      const messages = {
        dismissed: ['Dismissed'],
        claimed: ['Marked as claimed'],
        recovered: ['Money recovered!', 'That is the whole point of iTrack. Enjoy!'],
        detected: ['Restored'],
      };
      toast.success(...(messages[status] ?? ['Updated']));
      await load();
    } catch (err) {
      toast.notifyError(err, 'Cannot update refund');
    } finally {
      setBusyId(null);
    }
  };

  if (opps === null && !error) {
    return (
      <div className="max-w-2xl mx-auto space-y-4" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-36 bg-muted rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24 max-w-md mx-auto">
        <p className="text-lg font-semibold mb-2">Could not load your refund radar</p>
        <p className="text-muted-foreground mb-6">Check your connection and try again.</p>
        <Button onClick={load} variant="outline">
          <RefreshCw className="w-4 h-4 me-2" /> Retry
        </Button>
      </div>
    );
  }

  if (opps.length === 0) {
    return (
      <div className="text-center py-24 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-secondary grid place-items-center mx-auto mb-5">
          <ReceiptText className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight mb-2">Refund radar</h1>
        <p className="text-muted-foreground">
          No packages are late enough to claim on right now. That is good news: iTrack checks every
          late order against known merchant and payment-provider policies and will surface a case
          the moment one is worth acting on.
        </p>
      </div>
    );
  }

  const actNow = opps
    .filter((o) => ['detected', 'notified'].includes(o.status))
    .filter((o) => ['dispute', 'likely_lost'].includes(o.stage) || (daysUntilDate(o.deadline) ?? 999) <= URGENT_DEADLINE_DAYS)
    .sort((a, b) => {
      const da = a.deadline ?? '9999-12-31';
      const db = b.deadline ?? '9999-12-31';
      return da !== db ? da.localeCompare(db) : (b.days_late ?? 0) - (a.days_late ?? 0);
    });
  const actNowIds = new Set(actNow.map((o) => o.id));
  const watching = opps
    .filter((o) => ['detected', 'notified'].includes(o.status) && !actNowIds.has(o.id))
    .sort((a, b) => (b.days_late ?? 0) - (a.days_late ?? 0));
  const inProgress = opps.filter((o) => o.status === 'claimed');
  const history = opps.filter((o) => ['dismissed', 'recovered'].includes(o.status));

  const sectionProps = { ordersById, onAct: act, busyId, onPaymentMethodSet: load };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold tracking-tight mb-1">Refund radar</h1>
      <p className="text-sm text-muted-foreground mb-6">Late packages that may owe you money, with ready-to-send claims.</p>

      <Section title={actNow.length ? 'Act now' : null} items={actNow} {...sectionProps} />
      <Section title={watching.length ? 'Watching' : null} items={watching} {...sectionProps} />
      <Section title={inProgress.length ? 'In progress' : null} items={inProgress} {...sectionProps} />

      {history.length > 0 && (
        <div>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors mb-3"
            aria-expanded={historyOpen}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            History / {history.length}
          </button>
          {historyOpen && (
            <div className="space-y-4 opacity-80">
              {history.map((opp) => (
                <RefundCase
                  key={opp.id}
                  opportunity={opp}
                  order={ordersById[opp.order_id]}
                  onAct={act}
                  busy={busyId === opp.id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
