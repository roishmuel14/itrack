import { useState } from 'react';
import { X, ClipboardPaste, Hash } from 'lucide-react';
import { invokeFunction } from '@/api/functions';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Manual add (PRD F9): paste an order email OR enter a tracking number.
// The judge path with zero email setup; errors surface the server's
// reasons[] verbatim as toasts (stage 4 DoD).
export default function ManualAddDialog({ open, onClose, onAdded }) {
  const toast = useToast();
  const [tab, setTab] = useState('paste'); // paste | tracking
  const [emailText, setEmailText] = useState('');
  const [tracking, setTracking] = useState('');
  const [merchant, setMerchant] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = tab === 'paste'
        ? { email_text: emailText }
        : { tracking_number: tracking.trim(), merchant_name: merchant.trim() };
      const res = await invokeFunction('orders/manualAdd', payload);
      if (res?.already_exists) {
        toast.success('Already tracked', 'That tracking number is on an order you already have.');
      } else {
        toast.success('Order added', 'Your package is now being tracked.');
      }
      setEmailText('');
      setTracking('');
      setMerchant('');
      onAdded?.(res);
      onClose();
    } catch (err) {
      toast.notifyError(err, 'Cannot add order');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Add an order">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
      <div className="relative bg-card rounded-2xl card-shadow-hover border w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Add an order</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-muted rounded-xl p-1 mb-4" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'paste'}
            onClick={() => setTab('paste')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'paste' ? 'bg-card card-shadow text-foreground' : 'text-muted-foreground'}`}
          >
            <ClipboardPaste className="w-4 h-4" /> Paste an email
          </button>
          <button
            role="tab"
            aria-selected={tab === 'tracking'}
            onClick={() => setTab('tracking')}
            className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'tracking' ? 'bg-card card-shadow text-foreground' : 'text-muted-foreground'}`}
          >
            <Hash className="w-4 h-4" /> Tracking number
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {tab === 'paste' ? (
            <textarea
              required
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
              placeholder="Paste the full text of an order or shipping email here. We'll read the merchant, items, dates, and tracking out of it."
              rows={8}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            />
          ) : (
            <>
              <Input required placeholder="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
              <Input required placeholder="Store name (e.g. Amazon)" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </>
          )}
          <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90">
            {busy ? 'Reading your email...' : 'Add order'}
          </Button>
        </form>
      </div>
    </div>
  );
}
