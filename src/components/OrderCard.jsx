import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, AlertCircle, CheckCircle2, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import {
  CHIP_BASE, countdownText, daysUntil, formatDate, formatMoney, progressPercent, refundStageChip, statusChip,
} from '@/lib/format';
import MerchantImage, { MerchantLogo } from '@/components/MerchantImage';

const DONE_STATUSES = ['delivered', 'cancelled', 'returned'];

// Route-style progress: a dashed track (the road still ahead) under a solid
// fill (the distance covered) and a "today" knob. On card hover the uncovered
// dashes march (.route-track in index.css): parcels in motion.
function RouteProgress({ order }) {
  const pct = progressPercent(order.ordered_at, order.promised_date);
  const overdue = !DONE_STATUSES.includes(order.status) && (daysUntil(order.promised_date) ?? 1) < 0;
  if (pct === null) {
    return <div className="route-track opacity-70" />;
  }
  const barColor = order.status === 'delivered'
    ? 'bg-[hsl(var(--status-delivered))]'
    : overdue
      ? 'bg-[hsl(var(--status-overdue))]'
      : 'bg-primary';
  return (
    <div className="relative h-1.5">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 route-track opacity-70" />
      <div className={`absolute inset-y-0 start-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      {order.status !== 'delivered' && pct < 100 && (
        <div
          className={`absolute -top-[3px] w-3 h-3 rounded-full bg-card border-2 card-shadow ${
            overdue ? 'border-[hsl(var(--status-overdue))]' : 'border-primary'
          }`}
          style={{ left: `calc(${pct}% - 6px)` }}
          title="Today"
        />
      )}
    </div>
  );
}

export default function OrderCard({ order, refund, onMarkDelivered, onDelete, busy = false }) {
  const chip = statusChip(order.status);
  const refundChip = refund ? refundStageChip(refund.stage) : null;
  const overdue = !DONE_STATUSES.includes(order.status) && (daysUntil(order.promised_date) ?? 1) < 0;
  const itemsSummary = (order.items ?? []).map((i) => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name)).join(', ');
  const canComplete = Boolean(onMarkDelivered) && !DONE_STATUSES.includes(order.status);
  const lowConfidence = order.confidence != null && order.confidence < 0.6;
  const eta = countdownText(order.eta_date || order.promised_date, { delivered: order.status === 'delivered' });
  const deliveredLine = order.delivered_at ? `delivered ${formatDate(order.delivered_at)}` : 'delivered';

  // Card-level overflow menu. It lives inside the card's overflow-hidden box, so
  // it opens downward from the top-start corner where there is always room.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    // Stretched-link pattern: the whole card is clickable via the absolutely
    // positioned <Link>, which keeps the action button a sibling rather than a
    // button nested inside an anchor. `group` drives the hover choreography
    // (lift here, photo zoom + marching dashes in the children).
    <div
      className={`group relative bg-card rounded-2xl border overflow-hidden card-shadow hover:card-shadow-hover hover:-translate-y-0.5 transition-[transform,box-shadow] duration-200 ease-out motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        overdue ? 'border-[hsl(var(--status-overdue))]/40 ring-1 ring-[hsl(var(--status-overdue))]/30' : ''
      }`}
    >
      <Link
        to={`/orders/${order.id}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="sr-only">{`Open order from ${order.merchant_name}`}</span>
      </Link>

      <div className="relative pointer-events-none">
        <MerchantImage order={order} className="h-40" />
        <span className={`${CHIP_BASE} absolute bottom-2.5 start-2.5 bg-white/85 backdrop-blur-md shadow-sm ${chip.textClassName}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
          {chip.label}
        </span>
      </div>

      {Boolean(onDelete) && (
        <div className="absolute top-2 start-2 z-10" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy}
            aria-label={`More actions for the order from ${order.merchant_name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="inline-grid place-items-center w-8 h-8 rounded-full bg-white/85 backdrop-blur-md border border-white/50 shadow-sm text-foreground/70 hover:text-foreground hover:bg-white disabled:opacity-60 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-9 start-0 min-w-[10.5rem] rounded-xl border bg-card card-shadow-hover p-1"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(order);
                }}
                className="flex items-center gap-2 w-full text-start px-2.5 py-2 rounded-lg text-sm font-medium text-[hsl(var(--status-overdue))] hover:bg-[hsl(var(--status-overdue-bg))] transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete order
              </button>
            </div>
          )}
        </div>
      )}

      {canComplete && (
        <button
          type="button"
          onClick={() => onMarkDelivered(order)}
          disabled={busy}
          aria-label={`Mark order from ${order.merchant_name} as delivered`}
          title="Mark delivered"
          className="absolute top-2 end-2 z-10 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full bg-white/85 backdrop-blur-md border border-white/50 shadow-sm text-foreground hover:bg-[hsl(var(--status-delivered-bg))] hover:text-[hsl(var(--status-delivered))] disabled:opacity-60 transition-colors"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--status-delivered))]" />
          )}
          Delivered
        </button>
      )}

      <div className="p-4 pt-3.5 pointer-events-none">
        <div className="flex items-center gap-2 min-w-0">
          <MerchantLogo order={order} size={20} />
          <p className="font-semibold text-[15px] truncate min-w-0 flex-1">{order.merchant_name}</p>
          {order.total != null && (
            <p className="font-mono text-[13px] font-semibold tabular-nums whitespace-nowrap">
              {formatMoney(order.total, order.currency)}
            </p>
          )}
        </div>
        <p dir="auto" className="text-sm text-muted-foreground truncate mt-1" title={itemsSummary}>
          {itemsSummary || order.order_number || 'Order'}
        </p>
        {(refundChip || lowConfidence) && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {refundChip && (
              <span className={`${CHIP_BASE} ${refundChip.className}`}>
                <BadgePercent className="w-3 h-3" /> Refund case: {refundChip.label}
              </span>
            )}
            {lowConfidence && (
              <span
                className={`${CHIP_BASE} bg-muted text-muted-foreground`}
                title="We were not fully sure reading this email; tap to check"
              >
                <AlertCircle className="w-3 h-3" /> Check this
              </span>
            )}
          </div>
        )}
        <div className="mt-3 border-t border-dashed pt-3">
          <RouteProgress order={order} />
          <div className="flex items-center justify-between gap-2 mt-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]">
            <p className={overdue ? 'text-[hsl(var(--status-overdue))]' : 'text-muted-foreground'}>
              {eta ?? deliveredLine}
            </p>
            {order.order_number && (
              <p className="text-muted-foreground/70 truncate max-w-[45%]" title={`Order ${order.order_number}`}>
                #{order.order_number}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
