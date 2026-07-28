import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2, Mail, Package, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { Order, RefundOpportunity, TrackingEvent, subscribeTo } from '@/api/entities';
import { useAuth } from '@/api/auth';
import { useGmailSync } from '@/api/useGmailSync';
import { invokeFunction } from '@/api/functions';
import { runImageEnrichment } from '@/api/enrichment';
import { useToast } from '@/lib/toast';
import { GMAIL_CONNECT_ENABLED } from '@/lib/config';
import { Button } from '@/components/ui/button';
import Barcode from '@/components/Barcode';
import ManualAddDialog from '@/components/ManualAddDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import DeliveredDialog from '@/components/DeliveredDialog';
import OrderCard from '@/components/OrderCard';
import ActivityFeed from '@/components/ActivityFeed';
import { daysUntil, formatDate, formatMoney } from '@/lib/format';

const ACTIVE_STATUSES = ['ordered', 'shipped', 'in_transit', 'out_for_delivery', 'delayed'];
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'transit', label: 'In transit' },
  { key: 'soon', label: 'Arriving soon' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'delivered', label: 'Delivered' },
];

function isOverdue(o) {
  return ACTIVE_STATUSES.includes(o.status) && (daysUntil(o.promised_date) ?? 1) < 0;
}
function isArrivingSoon(o) {
  const d = daysUntil(o.eta_date || o.promised_date);
  return ACTIVE_STATUSES.includes(o.status) && d != null && d >= 0 && d <= 3;
}

// The stats read as ONE manifest strip: a single card cut into label fields by
// dashed rules, the way a shipping label separates its data blocks. Divider
// classes are static per cell (2x2 on mobile, 1x4 on desktop) so Tailwind can
// see them.
const STAT_DIVIDERS = [
  'border-e border-b lg:border-b-0 border-dashed',
  'border-b lg:border-b-0 lg:border-e border-dashed',
  'border-e border-dashed',
  '',
];

function StatCell({ label, value, tone, dividers }) {
  return (
    <div className={`px-4 py-3.5 ${dividers}`}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`font-display font-extrabold text-[26px] leading-none tracking-tight tabular-nums mt-1.5 ${tone ?? ''}`}>
        {value}
      </p>
    </div>
  );
}

// After a sync lands new orders, quietly repair their logos and pull HQ product
// photos; the realtime subscription repaints cards as writes arrive.
function enrichAfterSync() {
  runImageEnrichment({ rounds: 6 }).catch(() => {});
}

export default function Dashboard() {
  const { gmail } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState(null);
  const [events, setEvents] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showDelivered, setShowDelivered] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [completingId, setCompletingId] = useState(null);
  const [deliveringOrder, setDeliveringOrder] = useState(null);
  const [deletingOrder, setDeletingOrder] = useState(null);
  const reloadTimer = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setError(false);
      setOrders(null);
    }
    try {
      const [o, e, r] = await Promise.all([
        Order.list('-last_event_at', 500),
        TrackingEvent.list('-occurred_at', 30),
        RefundOpportunity.filter({ status: 'detected' }, '-created_date', 100).catch(() => []),
      ]);
      setOrders(o.filter((x) => !x.is_archived));
      setEvents(e);
      setRefunds(r);
    } catch (err) {
      console.error(err);
      if (!silent) {
        setError(true);
        setOrders([]);
      }
    }
  }, []);

  // Same server-side state authority as the detail page: the function owns the
  // transition, we just reflect it. Realtime also refreshes the grid, but we
  // reload so the card moves the moment the call returns.
  const confirmDelivered = useCallback(async (deliveredAt) => {
    const order = deliveringOrder;
    if (!order) return;
    setCompletingId(order.id);
    try {
      await invokeFunction('orders/setStatus', {
        order_id: order.id,
        action: 'mark_delivered',
        delivered_at: deliveredAt,
      });
      setDeliveringOrder(null);
      toast.success('Marked delivered', `Arrived ${formatDate(deliveredAt)}. Nice, another one home.`);
      await load(true);
    } catch (err) {
      toast.notifyError(err, 'Cannot update order');
    } finally {
      setCompletingId(null);
    }
  }, [deliveringOrder, load, toast]);

  const confirmDelete = useCallback(async () => {
    const order = deletingOrder;
    if (!order) return;
    setCompletingId(order.id);
    try {
      await invokeFunction('orders/setStatus', { order_id: order.id, action: 'delete' });
      setDeletingOrder(null);
      // Drop it locally first: the row is gone server-side, so waiting on the
      // reload would leave a card the user just deleted on screen.
      setOrders((prev) => (prev ?? []).filter((o) => o.id !== order.id));
      toast.success('Order deleted', `The ${order.merchant_name} order and its history are gone.`);
      await load(true);
    } catch (err) {
      toast.notifyError(err, 'Cannot delete order');
    } finally {
      setCompletingId(null);
    }
  }, [deletingOrder, load, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime (PRD F6): new/updated cards appear without refresh, with a toast
  // for fresh tracking events. Reloads are debounced against event bursts.
  useEffect(() => {
    const scheduleReload = () => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => load(true), 800);
    };
    const unsubOrder = subscribeTo(Order, scheduleReload);
    const unsubEvent = subscribeTo(TrackingEvent, (evt) => {
      if (evt.type === 'create' && evt.data?.title) {
        toast.info(evt.data.title, evt.data?.description ? undefined : undefined);
      }
      scheduleReload();
    });
    return () => {
      clearTimeout(reloadTimer.current);
      unsubOrder();
      unsubEvent();
    };
  }, [load, toast]);

  const { sync, syncing, progress } = useGmailSync();
  const syncedOnce = useRef(false);
  useEffect(() => {
    if (!GMAIL_CONNECT_ENABLED || !gmail.connected || syncedOnce.current) return;
    syncedOnce.current = true;
    sync().then((res) => {
      if (res.ok && res.processed > 0) {
        toast.success('Inbox synced', `${res.processed} new order update${res.processed === 1 ? '' : 's'}.`);
        load(true);
        enrichAfterSync();
      }
    });
  }, [gmail.connected, sync, toast, load]);

  const refundsByOrder = useMemo(() => {
    const m = {};
    for (const r of refunds) m[r.order_id] = (m[r.order_id] ?? 0) + 1;
    return m;
  }, [refunds]);

  const ordersById = useMemo(() => {
    const m = {};
    for (const o of orders ?? []) m[o.id] = o;
    return m;
  }, [orders]);

  if (orders === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading orders">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border card-shadow overflow-hidden animate-pulse">
            <div className="h-40 bg-muted" />
            <div className="p-4">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-muted shrink-0" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
              <div className="h-3 bg-muted rounded w-2/3 mt-2.5" />
              <div className="mt-4 border-t border-dashed pt-3.5">
                <div className="h-1.5 bg-muted rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24">
        <p className="text-lg font-semibold mb-2">Could not load your packages</p>
        <p className="text-muted-foreground mb-6">Check your connection and try again.</p>
        <Button onClick={() => load()} variant="outline">
          <RefreshCw className="w-4 h-4 me-2" /> Retry
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <>
        <div className="max-w-xl mx-auto text-center py-14">
          <div
            className="w-16 h-16 rounded-2xl grid place-items-center mx-auto mb-5"
            style={{ background: 'linear-gradient(140deg, hsl(258 55% 95%), hsl(258 48% 90%) 60%, hsl(298 50% 93%))' }}
          >
            <span className="w-11 h-11 rounded-xl bg-white/90 ring-1 ring-black/5 card-shadow grid place-items-center" style={{ color: 'hsl(258 40% 38%)' }}>
              <Package className="w-6 h-6" strokeWidth={1.75} />
            </span>
          </div>
          <p className="kicker text-primary mb-2">First scan</p>
          <h1 className="display-head text-3xl md:text-4xl mb-3">
            Your deliveries,{' '}
            <span className="relative inline-block text-primary">
              one dashboard
              <svg className="absolute -bottom-1.5 left-0 w-full" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M4 9 C 40 3, 82 3, 116 7" stroke="#F59E0B" strokeWidth="6" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="text-muted-foreground mb-8">
            Paste any order or shipping email and iTrack turns it into a live tracking card, with a
            progress bar, ETA countdown, and a refund alert if it runs late.
          </p>
          <div className="bg-card rounded-2xl border card-shadow p-6 text-start mb-6">
            {GMAIL_CONNECT_ENABLED && syncing ? (
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div className="text-sm">
                  <p className="font-medium">Scanning your inbox...</p>
                  <p className="text-muted-foreground">{progress?.processed ?? 0} order emails imported so far</p>
                </div>
              </div>
            ) : GMAIL_CONNECT_ENABLED && gmail.connected ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">Gmail is connected. Scan your inbox for orders:</p>
                <Button onClick={() => sync().then((r) => { if (r.ok) { load(); if (r.processed > 0) enrichAfterSync(); } })}>
                  <Sparkles className="w-4 h-4 me-1.5" /> Scan my inbox
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <Plus className="w-4 h-4 text-primary" /> Add your first order in seconds
                </p>
                <Button onClick={() => setAddOpen(true)}>
                  <Sparkles className="w-4 h-4 me-1.5" /> Paste an order email
                </Button>
              </div>
            )}
          </div>
          {GMAIL_CONNECT_ENABLED ? (
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 me-1.5" /> Or paste an email instead
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Automatic Gmail sync is coming soon.
            </p>
          )}
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mt-8">
            Paste &#183; track &#183; relax
          </p>
        </div>
        <ManualAddDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => load()} />
      </>
    );
  }

  const active = orders.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const delivered = orders.filter((o) => o.status === 'delivered');
  const overdueList = active.filter(isOverdue);
  const soonList = active.filter(isArrivingSoon);
  const refundSum = refunds.reduce((sum, r) => sum + (r.amount_estimate ?? 0), 0);

  const etaSorted = (list) =>
    [...list].sort((a, b) => {
      const da = a.eta_date || a.promised_date || '9999-12-31';
      const db = b.eta_date || b.promised_date || '9999-12-31';
      return da.localeCompare(db);
    });

  let visible;
  switch (filter) {
    case 'transit':
      visible = etaSorted(active.filter((o) => ['shipped', 'in_transit', 'out_for_delivery'].includes(o.status)));
      break;
    case 'soon':
      visible = etaSorted(soonList);
      break;
    case 'overdue':
      visible = etaSorted(overdueList);
      break;
    case 'delivered':
      visible = delivered;
      break;
    default:
      visible = etaSorted(active);
  }

  return (
    <>
      <div className="flex items-end justify-between gap-3 mb-6">
        <div>
          <p className="kicker text-primary">Tracking manifest</p>
          <h1 className="display-head mt-1.5 text-3xl md:text-[34px]">Your packages</h1>
        </div>
        <Barcode className="hidden sm:flex opacity-60 mb-1" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 bg-card rounded-2xl border card-shadow overflow-hidden mb-6">
        <StatCell label="Active packages" value={active.length} dividers={STAT_DIVIDERS[0]} />
        <StatCell label="Arriving this week" value={soonList.length} dividers={STAT_DIVIDERS[1]} />
        <StatCell
          label="Overdue"
          value={overdueList.length}
          tone={overdueList.length ? 'text-[hsl(var(--status-overdue))]' : ''}
          dividers={STAT_DIVIDERS[2]}
        />
        <StatCell
          label="Refunds found"
          value={refundSum > 0 ? formatMoney(refundSum, 'USD') : refunds.length || 0}
          tone={refunds.length ? 'text-[hsl(var(--status-soon))]' : ''}
          dividers={STAT_DIVIDERS[3]}
        />
      </div>

      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div
          className="flex items-center gap-1 rounded-full border bg-card p-1 overflow-x-auto no-scrollbar"
          role="tablist"
          aria-label="Filter orders"
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3.5 py-1.5 rounded-full font-mono text-[11px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap transition-colors ${
                filter === f.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {f.label}
              {f.key === 'overdue' && overdueList.length > 0 && (
                <span className={`ms-1.5 font-bold ${filter === f.key ? 'text-background/70' : 'text-[hsl(var(--status-overdue))]'}`}>
                  {overdueList.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {GMAIL_CONNECT_ENABLED && gmail.connected && (
            <Button
              variant="ghost"
              className="rounded-full px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
              onClick={() => sync().then((r) => { if (r.ok) { load(true); if (r.processed > 0) enrichAfterSync(); } })}
              disabled={syncing}
              title="Check Gmail for new updates"
            >
              {syncing ? <Loader2 className="w-4 h-4 me-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 me-1.5" />}
              {syncing ? 'Syncing...' : 'Sync now'}
            </Button>
          )}
          <Button
            onClick={() => setAddOpen(true)}
            className="rounded-full px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]"
          >
            <Plus className="w-4 h-4 me-1.5" /> Add order
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div>
          {visible.length === 0 ? (
            <div className="text-center py-16 rounded-2xl border-2 border-dashed">
              <Package className="w-6 h-6 text-muted-foreground/50 mx-auto mb-3" aria-hidden="true" />
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                No packages in this view
              </p>
              <Button
                variant="ghost"
                className="mt-3 rounded-full px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary"
                onClick={() => setFilter('all')}
              >
                View all
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((o) => (
                <OrderCard
                  key={o.id}
                  order={o}
                  refundCount={refundsByOrder[o.id] ?? 0}
                  onMarkDelivered={setDeliveringOrder}
                  onDelete={setDeletingOrder}
                  busy={completingId === o.id}
                />
              ))}
            </div>
          )}

          {filter !== 'delivered' && delivered.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowDelivered((s) => !s)}
                  className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
                  aria-expanded={showDelivered}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showDelivered ? 'rotate-180' : ''}`} />
                  Delivered / {delivered.length}
                </button>
                <div className="flex-1 border-t border-dashed" aria-hidden="true" />
              </div>
              {showDelivered && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 mt-4">
                  {delivered.map((o) => (
                    <OrderCard key={o.id} order={o} onDelete={setDeletingOrder} busy={completingId === o.id} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="hidden lg:block sticky top-20">
          <ActivityFeed events={events} ordersById={ordersById} />
        </aside>
      </div>
      <ManualAddDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={() => load()} />
      <DeliveredDialog
        open={Boolean(deliveringOrder)}
        order={deliveringOrder}
        busy={completingId === deliveringOrder?.id}
        onConfirm={confirmDelivered}
        onClose={() => setDeliveringOrder(null)}
      />
      <ConfirmDialog
        open={Boolean(deletingOrder)}
        title="Delete this order?"
        body={`The ${deletingOrder?.merchant_name ?? ''} order, its shipments, timeline, and refund alerts are removed for good. Syncing your inbox again will not bring it back.`}
        confirmLabel="Delete order"
        busy={completingId === deletingOrder?.id}
        onConfirm={confirmDelete}
        onClose={() => setDeletingOrder(null)}
      />
    </>
  );
}
