import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, CheckCircle2, ExternalLink, ReceiptText, XCircle } from 'lucide-react';
import { Order, RefundOpportunity } from '@/api/entities';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import CopyButton from '@/components/CopyButton';
import { daysUntil, formatDate, formatMoney } from '@/lib/format';

const POLICY_LABELS = {
  temu_on_time: 'Temu on-time delivery credit',
  aliexpress_buyer_protection: 'AliExpress buyer protection',
  amazon_guaranteed: 'Amazon guaranteed delivery',
  shein_late_credit: 'Shein late-shipment credit',
  paypal_180: 'PayPal buyer protection',
  cc_chargeback: 'Credit card chargeback',
};

function DeadlineBadge({ deadline }) {
  const days = daysUntil(deadline);
  if (days == null) return null;
  const urgent = days <= 3;
  return (
    <span
      className={`text-xs font-semibold px-2 py-1 rounded-full ${
        urgent
          ? 'bg-[hsl(var(--status-overdue-bg))] text-[hsl(var(--status-overdue))]'
          : 'bg-[hsl(var(--status-soon-bg))] text-[hsl(var(--status-soon))]'
      }`}
    >
      {days < 0 ? 'window closed' : days === 0 ? 'last day to claim' : `${days} days left to claim`}
    </span>
  );
}

export default function Refunds() {
  const toast = useToast();
  const [opps, setOpps] = useState(null);
  const [orders, setOrders] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, o] = await Promise.all([
        RefundOpportunity.list('-created_date', 200),
        Order.list('-last_event_at', 500),
      ]);
      setOpps(r);
      setOrders(o);
    } catch (err) {
      console.error(err);
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
      toast.success(
        status === 'dismissed' ? 'Dismissed' : status === 'claimed' ? 'Marked as claimed' : 'Money recovered!',
        status === 'recovered' ? 'That is the whole point of iTrack. Enjoy!' : undefined,
      );
      await load();
    } catch (err) {
      toast.notifyError(err, 'Cannot update refund');
    } finally {
      setBusyId(null);
    }
  };

  if (opps === null) {
    return (
      <div className="max-w-2xl mx-auto space-y-4" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-36 bg-muted rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  const open = opps.filter((r) => ['detected', 'notified'].includes(r.status));
  const claimed = opps.filter((r) => r.status === 'claimed');
  const closed = opps.filter((r) => ['dismissed', 'recovered'].includes(r.status));

  if (opps.length === 0) {
    return (
      <div className="text-center py-24 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-secondary grid place-items-center mx-auto mb-5">
          <ReceiptText className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight mb-2">Refund radar</h1>
        <p className="text-muted-foreground">
          When a package runs late, iTrack checks the merchant's refund policies and drafts your claim automatically.
          Nothing to claim right now: that is good news.
        </p>
      </div>
    );
  }

  const OppCard = ({ opp, showActions }) => {
    const order = ordersById[opp.order_id];
    return (
      <div className="bg-card rounded-2xl border card-shadow p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="min-w-0">
            <p className="font-semibold flex items-center gap-2">
              <BadgePercent className="w-4 h-4 text-[hsl(var(--status-soon))]" />
              {POLICY_LABELS[opp.policy_key] ?? opp.policy_key}
            </p>
            {order && (
              <Link to={`/orders/${order.id}`} className="text-sm text-muted-foreground hover:text-primary">
                {order.merchant_name}
                {order.order_number ? ` - order ${order.order_number}` : ''}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2">
            {opp.amount_estimate != null && (
              <span className="text-sm font-bold">{formatMoney(opp.amount_estimate, order?.currency ?? 'USD')}</span>
            )}
            {showActions ? <DeadlineBadge deadline={opp.deadline} /> : (
              <span className="text-xs font-medium text-muted-foreground capitalize">{opp.status}</span>
            )}
          </div>
        </div>

        {opp.deadline && showActions && (
          <p className="text-xs text-muted-foreground mb-3">Claim by {formatDate(opp.deadline)}</p>
        )}

        {opp.draft_message && (
          <div className="bg-muted rounded-xl p-3.5 mb-3">
            <p className="text-sm whitespace-pre-line break-words max-h-36 overflow-y-auto">{opp.draft_message}</p>
            <div className="mt-2 pt-2 border-t border-border/70">
              <CopyButton text={opp.draft_message} label="Copy claim message" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {opp.claim_url && (
            <a href={opp.claim_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="h-9">
                <ExternalLink className="w-4 h-4 me-1.5" /> Open claim page
              </Button>
            </a>
          )}
          {showActions && (
            <>
              <Button variant="outline" size="sm" className="h-9" disabled={busyId === opp.id} onClick={() => act(opp.id, 'claimed')}>
                <CheckCircle2 className="w-4 h-4 me-1.5 text-[hsl(var(--status-transit))]" /> I filed a claim
              </Button>
              <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" disabled={busyId === opp.id} onClick={() => act(opp.id, 'dismissed')}>
                <XCircle className="w-4 h-4 me-1.5" /> Dismiss
              </Button>
            </>
          )}
          {opp.status === 'claimed' && (
            <Button variant="outline" size="sm" className="h-9" disabled={busyId === opp.id} onClick={() => act(opp.id, 'recovered')}>
              <CheckCircle2 className="w-4 h-4 me-1.5 text-[hsl(var(--status-delivered))]" /> Money arrived
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold tracking-tight mb-1">Refund radar</h1>
      <p className="text-sm text-muted-foreground mb-6">Late packages that may owe you money, with ready-to-send claims.</p>

      {open.length > 0 && (
        <div className="space-y-4 mb-8">
          {open.map((opp) => <OppCard key={opp.id} opp={opp} showActions />)}
        </div>
      )}
      {open.length === 0 && (
        <div className="bg-card rounded-2xl border card-shadow p-6 text-center mb-8">
          <p className="text-sm text-muted-foreground">No open refund opportunities right now.</p>
        </div>
      )}

      {claimed.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">Waiting for money</h2>
          <div className="space-y-4 mb-8">
            {claimed.map((opp) => <OppCard key={opp.id} opp={opp} showActions={false} />)}
          </div>
        </>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">History</h2>
          <div className="space-y-4 opacity-70">
            {closed.map((opp) => <OppCard key={opp.id} opp={opp} showActions={false} />)}
          </div>
        </>
      )}
    </div>
  );
}
