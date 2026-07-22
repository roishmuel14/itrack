import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { formatDateTime } from '@/lib/format';

// Latest TrackingEvents, newest first (PRD F10 in-app feed).
export default function ActivityFeed({ events, ordersById }) {
  if (!events?.length) {
    return (
      <div className="bg-card rounded-2xl border card-shadow p-5 text-center">
        <Activity className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Updates about your packages will appear here.</p>
      </div>
    );
  }
  return (
    <div className="bg-card rounded-2xl border card-shadow p-4">
      <p className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Activity className="w-4 h-4 text-primary" /> Latest activity
      </p>
      <ol className="space-y-3">
        {events.slice(0, 12).map((e) => {
          const order = ordersById?.[e.order_id];
          return (
            <li key={e.id} className="text-sm">
              <Link to={`/orders/${e.order_id}`} className="group block">
                <p className="font-medium group-hover:text-primary transition-colors">
                  {order ? `${order.merchant_name}: ` : ''}{e.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(e.occurred_at)}</p>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
