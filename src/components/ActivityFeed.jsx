import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { MerchantLogo } from '@/components/MerchantImage';

// Latest TrackingEvents, newest first (PRD F10 in-app feed), styled as a
// carrier scan timeline: merchant logos are the scan nodes on a dashed rail,
// echoing the landing's how-it-works timeline.
export default function ActivityFeed({ events, ordersById }) {
  if (!events?.length) {
    return (
      <div className="bg-card rounded-2xl border card-shadow p-5 text-center">
        <Activity className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          No scans yet
        </p>
        <p className="text-sm text-muted-foreground mt-1">Updates about your packages will appear here.</p>
      </div>
    );
  }
  return (
    <div className="bg-card rounded-2xl border card-shadow p-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] mb-4 flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-primary" /> Latest scans
      </p>
      <ol className="border-s border-dashed ms-2.5 ps-4 space-y-4">
        {events.slice(0, 10).map((e) => {
          const order = ordersById?.[e.order_id];
          return (
            <li key={e.id} className="relative">
              <span className="absolute -start-[25px] top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-card ring-1 ring-border overflow-hidden">
                {order ? (
                  <MerchantLogo order={order} size={14} rounded="rounded-full" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                )}
              </span>
              <Link to={`/orders/${e.order_id}`} className="group block">
                <p dir="auto" className="text-[13px] font-medium leading-snug group-hover:text-primary transition-colors">
                  {order ? `${order.merchant_name}: ` : ''}
                  {e.title}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground mt-0.5">
                  {formatDateTime(e.occurred_at)}
                </p>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
