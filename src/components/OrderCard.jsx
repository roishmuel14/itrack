import { Link } from 'react-router-dom';
import { Package, BadgePercent, AlertCircle } from 'lucide-react';
import { countdownText, daysUntil, formatMoney, progressPercent, statusChip } from '@/lib/format';

function ProgressBar({ order }) {
  const pct = progressPercent(order.ordered_at, order.promised_date);
  const overdue = !['delivered', 'cancelled', 'returned'].includes(order.status) && (daysUntil(order.promised_date) ?? 1) < 0;
  if (pct === null) {
    return (
      <div className="mt-3">
        <div className="h-1.5 rounded-full bg-muted" />
        <p className="text-xs text-muted-foreground mt-1.5">no ETA yet</p>
      </div>
    );
  }
  const barColor = order.status === 'delivered'
    ? 'bg-[hsl(var(--status-delivered))]'
    : overdue
      ? 'bg-[hsl(var(--status-overdue))]'
      : 'bg-primary';
  return (
    <div className="mt-3">
      <div className="relative h-1.5 rounded-full bg-muted overflow-visible">
        <div className={`absolute inset-y-0 start-0 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        {order.status !== 'delivered' && pct < 100 && (
          <div
            className="absolute -top-[3px] w-3 h-3 rounded-full bg-card border-2 border-primary card-shadow"
            style={{ left: `calc(${pct}% - 6px)` }}
            title="Today"
          />
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <p className={`text-xs font-medium ${overdue ? 'text-[hsl(var(--status-overdue))]' : 'text-muted-foreground'}`}>
          {countdownText(order.eta_date || order.promised_date, { delivered: order.status === 'delivered' }) ?? 'delivered'}
        </p>
      </div>
    </div>
  );
}

export default function OrderCard({ order, refundCount = 0 }) {
  const chip = statusChip(order.status);
  const overdue = !['delivered', 'cancelled', 'returned'].includes(order.status) && (daysUntil(order.promised_date) ?? 1) < 0;
  const firstImage = (order.items ?? []).find((i) => i.image_url)?.image_url;
  const itemsSummary = (order.items ?? []).map((i) => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name)).join(', ');

  return (
    <Link
      to={`/orders/${order.id}`}
      className={`block bg-card rounded-2xl border card-shadow hover:card-shadow-hover transition-shadow overflow-hidden ${
        overdue ? 'border-[hsl(var(--status-overdue))]/40 ring-1 ring-[hsl(var(--status-overdue))]/30' : ''
      }`}
    >
      <div className="h-36 bg-muted grid place-items-center overflow-hidden">
        {firstImage ? (
          <img src={firstImage} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <Package className="w-10 h-10 text-muted-foreground/40" />
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {order.logo_url && <img src={order.logo_url} alt="" className="w-5 h-5 rounded shrink-0" loading="lazy" />}
            <p className="font-semibold truncate">{order.merchant_name}</p>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${chip.className}`}>{chip.label}</span>
        </div>
        <p className="text-sm text-muted-foreground truncate" title={itemsSummary}>
          {itemsSummary || order.order_number || 'Order'}
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {order.total != null && <p className="text-sm font-semibold">{formatMoney(order.total, order.currency)}</p>}
          {refundCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--status-soon-bg))] text-[hsl(var(--status-soon))]">
              <BadgePercent className="w-3 h-3" /> refund available
            </span>
          )}
          {order.confidence != null && order.confidence < 0.6 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground" title="We were not fully sure reading this email; tap to check">
              <AlertCircle className="w-3 h-3" /> check this
            </span>
          )}
        </div>
        <ProgressBar order={order} />
      </div>
    </Link>
  );
}
