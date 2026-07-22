import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, PackageOpen, RefreshCw } from 'lucide-react';
import { Order } from '@/api/entities';
import { useAuth } from '@/api/auth';
import { useToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import CopyButton from '@/components/CopyButton';
import ManualAddDialog from '@/components/ManualAddDialog';
import { formatMoney, statusChip } from '@/lib/format';

// Stage 4 scope: correct loading / error / empty states and a simple order
// list. Stage 5 turns the list into the full card grid with progress bars,
// filters, stats, and realtime.
export default function Dashboard() {
  const { aliasAddress } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState(null); // null = loading
  const [error, setError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setOrders(null);
    try {
      const rows = await Order.list('-last_event_at', 200);
      setOrders(rows.filter((o) => !o.is_archived));
    } catch (err) {
      console.error(err);
      setError(true);
      setOrders([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (orders === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading orders">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border card-shadow p-5 animate-pulse space-y-3">
            <div className="h-32 bg-muted rounded-xl" />
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-1/2" />
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
        <Button onClick={load} variant="outline" className="rounded-xl">
          <RefreshCw className="w-4 h-4 me-2" /> Retry
        </Button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <>
        <div className="max-w-xl mx-auto text-center py-14">
          <div className="w-16 h-16 rounded-2xl bg-secondary grid place-items-center mx-auto mb-5">
            <PackageOpen className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight mb-2">Your deliveries, one dashboard</h1>
          <p className="text-muted-foreground mb-8">
            Forward any order email to your personal iTrack address and watch it become a live tracking card.
          </p>

          <div className="bg-card rounded-2xl border card-shadow p-5 text-start mb-6">
            <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-primary" /> Your iTrack address
            </p>
            {aliasAddress ? (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <code className="text-sm bg-muted rounded-lg px-2.5 py-1.5 break-all">{aliasAddress}</code>
                <CopyButton text={aliasAddress} label="Copy address" />
              </div>
            ) : (
              <div className="h-8 bg-muted rounded-lg animate-pulse" />
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Try it now: forward one order confirmation from your inbox, then watch the dashboard.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => setAddOpen(true)} className="rounded-xl bg-primary hover:bg-primary/90">
              <Plus className="w-4 h-4 me-1.5" /> Or paste an email instead
            </Button>
          </div>
        </div>
        <ManualAddDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-extrabold tracking-tight">Your packages</h1>
        <Button onClick={() => setAddOpen(true)} variant="outline" className="rounded-xl">
          <Plus className="w-4 h-4 me-1.5" /> Add order
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {orders.map((o) => {
          const chip = statusChip(o.status);
          return (
            <div key={o.id} className="bg-card rounded-2xl border card-shadow p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-semibold truncate">{o.merchant_name}</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${chip.className}`}>{chip.label}</span>
              </div>
              <p className="text-sm text-muted-foreground truncate">
                {(o.items ?? []).map((i) => i.name).join(', ') || o.order_number || 'Order'}
              </p>
              {o.total != null && <p className="text-sm font-medium mt-2">{formatMoney(o.total, o.currency)}</p>}
            </div>
          );
        })}
      </div>
      <ManualAddDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={load} />
    </>
  );
}
