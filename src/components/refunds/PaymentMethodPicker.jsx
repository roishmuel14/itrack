import { useState } from 'react';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';

// Order.payment_method enum, in the order a user is most likely to reach for
// one (PRD amendment v1.6: bit and cash_on_delivery are common in the
// Israeli market this app actually serves).
const OPTIONS = [
  { value: 'credit_card', label: 'Credit card' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'bit', label: 'Bit' },
  { value: 'debit_card', label: 'Debit card' },
  { value: 'apple_pay', label: 'Apple Pay' },
  { value: 'google_pay', label: 'Google Pay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash_on_delivery', label: 'Cash on delivery' },
  { value: 'gift_card', label: 'Gift card' },
  { value: 'other', label: 'Other' },
];

// Compact selector calling orders/setPaymentMethod (3.3): the moment-of-
// motivation surface for evidence the payment-dispute routes are gated on.
export default function PaymentMethodPicker({ orderId, onSet, autoFocus = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const handleChange = async (e) => {
    const value = e.target.value;
    if (!value) return;
    setBusy(true);
    try {
      await invokeFunction('orders/setPaymentMethod', { order_id: orderId, payment_method: value });
      toast.success('Payment method saved', 'Any dispute routes it unlocks will show on the next check.');
      onSet?.(value);
    } catch (err) {
      toast.notifyError(err, 'Cannot save payment method');
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      defaultValue=""
      disabled={busy}
      onChange={handleChange}
      autoFocus={autoFocus}
      aria-label="How did you pay for this order?"
      className="rounded-lg border bg-card text-xs font-medium px-2 py-1.5 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="" disabled>
        {busy ? 'Saving...' : 'How did you pay?'}
      </option>
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
