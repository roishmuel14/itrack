import { ExternalLink, Lock } from 'lucide-react';

const KIND_LABEL = {
  merchant_contact: 'Merchant',
  merchant_policy: 'Merchant policy',
  payment_dispute: 'Payment dispute',
};

function blockedReason(route) {
  if (route.blocked_by === 'window_closed') return 'Claim window has closed';
  if (route.blocked_by === 'not_late_enough') {
    const n = route.min_days_late ?? 1;
    return `Available from ${n} day${n === 1 ? '' : 's'} late`;
  }
  return null;
}

// One route, available or locked with its reason. Used for every route
// beneath the card's primary button (2.1 point 4): greyed when unavailable,
// with an inline unlock action for the one blocker a user can fix themselves.
export default function RouteRow({ route, onUnlockPaymentMethod }) {
  const locked = !route.available;
  const needsPaymentMethod = route.blocked_by === 'unknown_payment_method';
  const reason = needsPaymentMethod ? 'Add how you paid to unlock dispute options' : blockedReason(route);

  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${locked ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {locked && <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{route.label}</p>
          <p className="text-xs text-muted-foreground">{reason ?? KIND_LABEL[route.kind] ?? ''}</p>
        </div>
      </div>
      {needsPaymentMethod && onUnlockPaymentMethod ? (
        <button
          type="button"
          onClick={onUnlockPaymentMethod}
          className="text-xs font-semibold text-primary hover:text-primary/80 shrink-0 whitespace-nowrap"
        >
          Add payment method
        </button>
      ) : (
        !locked && route.url && (
          <a
            href={route.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-primary hover:text-primary/80 inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
          >
            Open <ExternalLink className="w-3 h-3" />
          </a>
        )
      )}
    </div>
  );
}
