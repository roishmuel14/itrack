import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArchiveRestore, ArrowLeft, CheckCircle2, ExternalLink, Truck,
} from 'lucide-react';
import { Order, Shipment, TrackingEvent, EmailRecord, RefundOpportunity, subscribeTo } from '@/api/entities';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import CopyButton from '@/components/CopyButton';
import { MerchantLogo } from '@/components/MerchantImage';
import PaymentMethodPicker from '@/components/refunds/PaymentMethodPicker';
import { CHIP_BASE, countdownText, daysUntil, formatDate, formatDateTime, formatMoney, progressPercent, refundStageChip, statusChip } from '@/lib/format';

const PAYMENT_METHOD_LABEL = {
  paypal: 'PayPal',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  bit: 'Bit',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  bank_transfer: 'Bank transfer',
  cash_on_delivery: 'Cash on delivery',
  gift_card: 'Gift card',
  other: 'Other',
};

const EVENT_DOT = {
  order_confirmation: 'bg-primary',
  shipment: 'bg-[hsl(var(--status-transit))]',
  transit_update: 'bg-[hsl(var(--status-transit))]',
  out_for_delivery: 'bg-[hsl(var(--status-soon))]',
  delivered: 'bg-[hsl(var(--status-delivered))]',
  delay: 'bg-[hsl(var(--status-overdue))]',
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [events, setEvents] = useState([]);
  const [emailsById, setEmailsById] = useState({});
  const [refunds, setRefunds] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | missing
  const [busy, setBusy] = useState(false);
  const reloadTimer = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState('loading');
    try {
      const o = await Order.get(id);
      if (!o) throw new Error('not found');
      const [s, e, r] = await Promise.all([
        Shipment.filter({ order_id: id }),
        TrackingEvent.filter({ order_id: id }, '-occurred_at', 200),
        RefundOpportunity.filter({ order_id: id }).catch(() => []),
      ]);
      const recIds = [...new Set(e.map((x) => x.email_record_id).filter(Boolean))];
      const recs = {};
      await Promise.all(
        recIds.map(async (rid) => {
          try {
            recs[rid] = await EmailRecord.get(rid);
          } catch {
            // record hidden or gone; timeline still renders without snippet
          }
        }),
      );
      setOrder(o);
      setShipments(s);
      setEvents(e);
      setEmailsById(recs);
      setRefunds(r);
      setState('ready');
    } catch (err) {
      console.error(err);
      setState('missing');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const scheduleReload = () => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => load(true), 800);
    };
    const unsubs = [subscribeTo(Order, scheduleReload), subscribeTo(TrackingEvent, scheduleReload)];
    return () => {
      clearTimeout(reloadTimer.current);
      unsubs.forEach((u) => u());
    };
  }, [load]);

  const act = async (action) => {
    setBusy(true);
    try {
      await invokeFunction('orders/setStatus', { order_id: id, action });
      if (action === 'mark_delivered') toast.success('Marked delivered', 'Nice, another one home.');
      if (action === 'archive') {
        toast.success('Order archived');
        navigate('/');
        return;
      }
      await load(true);
    } catch (err) {
      toast.notifyError(err, 'Cannot update order');
    } finally {
      setBusy(false);
    }
  };

  const chip = order ? statusChip(order.status) : null;
  const overdue = order && !['delivered', 'cancelled', 'returned'].includes(order.status) && (daysUntil(order.promised_date) ?? 1) < 0;
  const pct = order ? progressPercent(order.ordered_at, order.promised_date) : null;
  const openRefunds = useMemo(() => refunds.filter((r) => ['detected', 'notified'].includes(r.status)), [refunds]);

  if (state === 'loading') {
    return (
      <div className="max-w-3xl mx-auto space-y-4" aria-busy="true">
        <div className="h-8 bg-muted rounded-lg w-1/3 animate-pulse" />
        <div className="h-40 bg-muted rounded-2xl animate-pulse" />
        <div className="h-64 bg-muted rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className="text-center py-24">
        <p className="text-lg font-semibold mb-2">Order not found</p>
        <p className="text-muted-foreground mb-6">It may have been archived or removed.</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="w-4 h-4 me-2" /> Back to dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Dashboard
      </Link>

      <div className="bg-card rounded-2xl border card-shadow p-6 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <MerchantLogo order={order} size={40} rounded="rounded-xl" className="border" />
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight truncate">{order.merchant_name}</h1>
              {order.order_number && (
                <p className="text-sm text-muted-foreground">
                  Order {order.order_number}
                  {order.total != null && <> - {formatMoney(order.total, order.currency)}</>}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                <span>Paid with</span>
                {order.payment_method ? (
                  <span className="font-medium text-foreground">{PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method}</span>
                ) : (
                  <PaymentMethodPicker orderId={order.id} onSet={() => load(true)} />
                )}
              </div>
            </div>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-full ${chip.className}`}>{chip.label}</span>
        </div>

        {pct !== null && (
          <div className="mt-5">
            <div className="relative h-2 rounded-full bg-muted">
              <div
                className={`absolute inset-y-0 start-0 rounded-full ${order.status === 'delivered' ? 'bg-[hsl(var(--status-delivered))]' : overdue ? 'bg-[hsl(var(--status-overdue))]' : 'bg-primary'}`}
                style={{ width: `${order.status === 'delivered' ? 100 : pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>Ordered {formatDate(order.ordered_at)}</span>
              <span className={overdue ? 'text-[hsl(var(--status-overdue))] font-semibold' : ''}>
                {order.status === 'delivered'
                  ? 'Delivered'
                  : countdownText(order.eta_date || order.promised_date)}
                {order.promised_date && ` (promised ${formatDate(order.promised_date)})`}
              </span>
            </div>
          </div>
        )}

        {(order.items ?? []).length > 0 && (
          <ul className="mt-5 divide-y">
            {order.items.map((item, i) => (
              <li key={i} className="py-2.5 flex items-center gap-3">
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="w-11 h-11 rounded-lg object-cover border" loading="lazy" />
                ) : (
                  // No photo for this line item: fall back to the merchant mark
                  // rather than an anonymous grey box.
                  <MerchantLogo order={order} size={44} rounded="rounded-lg" className="border" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  {item.qty > 1 && <p className="text-xs text-muted-foreground">Qty {item.qty}</p>}
                </div>
                {item.price != null && <p className="text-sm font-medium">{formatMoney(item.price, order.currency)}</p>}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 mt-5 flex-wrap">
          {!['delivered', 'cancelled', 'returned'].includes(order.status) && (
            <Button onClick={() => act('mark_delivered')} disabled={busy} variant="outline">
              <CheckCircle2 className="w-4 h-4 me-1.5 text-[hsl(var(--status-delivered))]" /> Mark delivered
            </Button>
          )}
          <Button onClick={() => act(order.is_archived ? 'unarchive' : 'archive')} disabled={busy} variant="ghost">
            {order.is_archived ? <ArchiveRestore className="w-4 h-4 me-1.5" /> : <Archive className="w-4 h-4 me-1.5" />}
            {order.is_archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      </div>

      {openRefunds.length > 0 && (() => {
        const refund = openRefunds[0];
        const chip = refundStageChip(refund.stage);
        return (
          <div className="bg-[hsl(var(--status-soon-bg))] border border-[hsl(var(--status-soon))]/30 rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-semibold text-[hsl(var(--status-soon))]">This order may owe you money</p>
              <span className={`${CHIP_BASE} ${chip.className}`}>{chip.label}</span>
            </div>
            <p className="text-sm text-foreground/80 mb-3">
              {refund.days_late} day{refund.days_late === 1 ? '' : 's'} late. Review the case and claim from the Refunds screen.
            </p>
            <Link to="/refunds">
              <Button variant="outline" className="bg-card">Open refund radar</Button>
            </Link>
          </div>
        );
      })()}

      {shipments.length > 0 && (
        <div className="space-y-3 mb-4">
          {shipments.map((s) => {
            const sChip = statusChip(s.status);
            return (
              <div key={s.id} className="bg-card rounded-2xl border card-shadow p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-secondary grid place-items-center shrink-0">
                      <Truck className="w-4.5 h-4.5 text-primary" size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{s.carrier || 'Carrier unknown'}</p>
                      {s.tracking_number && (
                        <p className="text-xs text-muted-foreground font-mono truncate">{s.tracking_number}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${sChip.className}`}>{sChip.label}</span>
                    {s.eta_date && <span className="text-xs text-muted-foreground">ETA {formatDate(s.eta_date)}</span>}
                  </div>
                </div>
                {(s.tracking_number || s.tracking_url) && (
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t">
                    {s.tracking_number && <CopyButton text={s.tracking_number} label="Copy tracking number" />}
                    {s.tracking_url && (
                      <a
                        href={s.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                      >
                        <ExternalLink className="w-4 h-4" /> Track on {s.carrier || 'carrier site'}
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-card rounded-2xl border card-shadow p-6">
        <h2 className="font-bold mb-5">Timeline</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="relative border-s-2 border-muted ms-2 space-y-6">
            {events.map((e) => {
              const rec = e.email_record_id ? emailsById[e.email_record_id] : null;
              return (
                <li key={e.id} className="ms-5">
                  <span
                    className={`absolute -start-[7px] mt-1 w-3 h-3 rounded-full ring-4 ring-card ${EVENT_DOT[e.type] ?? 'bg-muted-foreground/40'}`}
                    aria-hidden="true"
                  />
                  <p className="text-sm font-semibold">{e.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDateTime(e.occurred_at)}
                    {e.source === 'manual' && ' - added manually'}
                  </p>
                  {(rec?.snippet || e.description) && (
                    <details className="mt-1.5">
                      <summary className="text-xs text-primary font-medium cursor-pointer select-none">source email</summary>
                      <blockquote className="text-xs text-muted-foreground bg-muted rounded-lg p-3 mt-1.5 whitespace-pre-line break-words max-h-40 overflow-y-auto">
                        {(rec?.snippet || e.description).slice(0, 600)}
                      </blockquote>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
