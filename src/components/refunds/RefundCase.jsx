import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, CheckCircle2, ExternalLink, RotateCcw, XCircle } from 'lucide-react';
import { CHIP_BASE, daysUntil, formatDate, formatMoney, refundStageChip } from '@/lib/format';
import { MerchantLogo } from '@/components/MerchantImage';
import { Button } from '@/components/ui/button';
import CopyButton from '@/components/CopyButton';
import RouteRow from '@/components/refunds/RouteRow';
import PaymentMethodPicker from '@/components/refunds/PaymentMethodPicker';

const KIND_CTA = {
  merchant_contact: (route) => route.label,
  merchant_policy: () => 'File a claim with the merchant',
  payment_dispute: () => 'File a payment dispute',
};

// Only order_total ever carries a real figure (Order.total). shipping_fee and
// store_credit are both merchant-set amounts we have no source for, so both
// show words, never a number (this is what stops the old bug: a shipping-fee
// guarantee advertised as the full order total).
const AMOUNT_LINE = {
  order_total: (o) => (o.amount_estimate != null ? `up to ${formatMoney(o.amount_estimate, o.currency)}` : null),
  shipping_fee: () => 'Shipping fee refund',
  store_credit: () => 'Store credit',
};
const AMOUNT_SUB = {
  order_total: 'if it never arrives',
  shipping_fee: 'amount set by the merchant',
  store_credit: 'amount set by the merchant',
};

// The refund radar's card (2.1): a 3-second read (which order, how late,
// what to do next), with everything else demoted behind disclosures. One
// card per late ORDER (not per policy), so there is never more than one of
// these per order.
export default function RefundCase({ opportunity: opp, order, onAct, busy, onPaymentMethodSet }) {
  const [draftOpen, setDraftOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!order) return null;

  const stageChip = refundStageChip(opp.stage);
  const routes = opp.routes ?? [];
  const claimRoutes = routes.filter((r) => r.kind !== 'merchant_contact');
  const primaryRoute = claimRoutes.find((r) => r.available) ?? routes.find((r) => r.kind === 'merchant_contact') ?? routes[0];
  const secondaryRoutes = routes.filter((r) => r !== primaryRoute);

  const delivered = opp.stage === 'delivered_late';
  const factHeadline = delivered ? `Arrived ${opp.days_late} days late` : `${opp.days_late} days late`;
  const factSub = delivered
    ? `promised ${formatDate(order.promised_date)}, delivered ${formatDate(order.last_event_at)}`
    : `promised ${formatDate(order.promised_date)}, still not delivered`;

  const showAmount = opp.amount_basis && opp.amount_basis !== 'unknown';
  const amountLine = showAmount ? AMOUNT_LINE[opp.amount_basis]?.(opp) ?? null : null;
  const amountSub = showAmount ? AMOUNT_SUB[opp.amount_basis] : null;

  const deadlineDays = daysUntil(opp.deadline);
  const showDeadline = opp.deadline && deadlineDays != null && deadlineDays <= 60;

  const recipientLabel = opp.draft_recipient === 'payment_provider' ? 'your payment provider' : `${order.merchant_name} support`;

  const open = ['detected', 'notified'].includes(opp.status);

  return (
    <div className="bg-card rounded-2xl border card-shadow p-5">
      <div className="flex items-start justify-between gap-3 mb-3.5">
        <Link to={`/orders/${order.id}`} className="flex items-center gap-2.5 min-w-0 group">
          <MerchantLogo order={order} size={28} rounded="rounded-lg" className="border" />
          <div className="min-w-0">
            <p className="font-semibold text-[15px] truncate group-hover:text-primary transition-colors">{order.merchant_name}</p>
            {order.order_number && <p className="text-xs text-muted-foreground truncate">order {order.order_number}</p>}
          </div>
        </Link>
        <span className={`${CHIP_BASE} ${stageChip.className} shrink-0`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
          {stageChip.label}
        </span>
      </div>

      <p className="font-display font-extrabold text-2xl tracking-tight">{factHeadline}</p>
      <p className="text-sm text-muted-foreground mt-0.5">{factSub}</p>

      {showAmount && amountLine && (
        <p className="text-sm font-semibold mt-3">
          {amountLine}
          {amountSub && <span className="font-normal text-muted-foreground"> &middot; {amountSub}</span>}
        </p>
      )}

      {showDeadline && (
        <p className="text-xs text-muted-foreground mt-1">
          {deadlineDays <= 0 ? 'Claim window closes today' : `${deadlineDays} day${deadlineDays === 1 ? '' : 's'} left to claim`}
          {' '}(by {formatDate(opp.deadline)})
        </p>
      )}

      {open && primaryRoute && (
        <div className="mt-4">
          {primaryRoute.url ? (
            <a href={primaryRoute.url} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full">
                {(KIND_CTA[primaryRoute.kind] ?? ((r) => r.label))(primaryRoute)}
                <ExternalLink className="w-4 h-4 ms-1.5" />
              </Button>
            </a>
          ) : (
            <Button className="w-full" onClick={() => setDraftOpen(true)}>
              {(KIND_CTA[primaryRoute.kind] ?? ((r) => r.label))(primaryRoute)}
            </Button>
          )}

          {secondaryRoutes.length > 0 && (
            <div className="mt-1 divide-y divide-dashed border-t border-dashed">
              {secondaryRoutes.map((r) => (
                <RouteRow
                  key={`${r.kind}:${r.policy_key}`}
                  route={r}
                  onUnlockPaymentMethod={r.blocked_by === 'unknown_payment_method' ? () => setPickerOpen(true) : undefined}
                />
              ))}
            </div>
          )}

          {pickerOpen && (
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <PaymentMethodPicker
                orderId={order.id}
                autoFocus
                onSet={() => {
                  setPickerOpen(false);
                  onPaymentMethodSet?.();
                }}
              />
            </div>
          )}
        </div>
      )}

      {opp.draft_message && (
        <div className="mt-3.5 border-t border-dashed pt-3.5">
          <button
            type="button"
            onClick={() => setDraftOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
            aria-expanded={draftOpen}
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${draftOpen ? 'rotate-180' : ''}`} />
            View draft message
          </button>
          {draftOpen && (
            <div className="bg-muted rounded-xl p-3.5 mt-2.5">
              <p className="text-xs text-muted-foreground mb-2">Addressed to {recipientLabel}</p>
              <p className="text-sm whitespace-pre-line break-words max-h-36 overflow-y-auto">{opp.draft_message}</p>
              <div className="mt-2 pt-2 border-t border-border/70">
                <CopyButton text={opp.draft_message} label="Copy claim message" />
              </div>
            </div>
          )}
        </div>
      )}

      {open && (
        <div className="flex items-center gap-2 flex-wrap mt-3.5 border-t border-dashed pt-3.5">
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" disabled={busy} onClick={() => onAct(opp.id, 'claimed')}>
            <CheckCircle2 className="w-3.5 h-3.5 me-1.5 text-[hsl(var(--status-transit))]" /> I filed a claim
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" disabled={busy} onClick={() => onAct(opp.id, 'dismissed')}>
            <XCircle className="w-3.5 h-3.5 me-1.5" /> Dismiss
          </Button>
        </div>
      )}
      {opp.status === 'claimed' && (
        <div className="flex items-center gap-2 flex-wrap mt-3.5 border-t border-dashed pt-3.5">
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => onAct(opp.id, 'recovered')}>
            <CheckCircle2 className="w-3.5 h-3.5 me-1.5 text-[hsl(var(--status-delivered))]" /> Money arrived
          </Button>
        </div>
      )}
      {opp.status === 'dismissed' && (
        <div className="flex items-center gap-2 flex-wrap mt-3.5 border-t border-dashed pt-3.5">
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" disabled={busy} onClick={() => onAct(opp.id, 'detected')}>
            <RotateCcw className="w-3.5 h-3.5 me-1.5" /> Restore
          </Button>
        </div>
      )}
    </div>
  );
}
