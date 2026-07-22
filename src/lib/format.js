// Shared formatters (BUILD_PLAN stage 4): dates DD/MM/YYYY, money by
// currency, countdowns, status metadata.

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mi}`;
}

const moneyFormatters = new Map();
export function formatMoney(amount, currency = 'USD') {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  const code = (currency || 'USD').toUpperCase();
  if (!moneyFormatters.has(code)) {
    try {
      moneyFormatters.set(
        code,
        new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 2 }),
      );
    } catch {
      moneyFormatters.set(code, null);
    }
  }
  const fmt = moneyFormatters.get(code);
  return fmt ? fmt.format(Number(amount)) : `${code} ${Number(amount).toFixed(2)}`;
}

// Whole-day difference from today (local) to an ISO date; negative = past.
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

// "arrives today" / "arrives in 3 days" / "2 days overdue" (PRD F3).
export function countdownText(isoDate, { delivered = false } = {}) {
  if (delivered) return null;
  const days = daysUntil(isoDate);
  if (days == null) return 'no ETA yet';
  if (days === 0) return 'arrives today';
  if (days === 1) return 'arrives tomorrow';
  if (days > 1) return `arrives in ${days} days`;
  if (days === -1) return '1 day overdue';
  return `${-days} days overdue`;
}

export const STATUS_META = {
  ordered: { label: 'Ordered', tone: 'neutral' },
  shipped: { label: 'Shipped', tone: 'transit' },
  in_transit: { label: 'In transit', tone: 'transit' },
  out_for_delivery: { label: 'Out for delivery', tone: 'soon' },
  delivered: { label: 'Delivered', tone: 'delivered' },
  delayed: { label: 'Delayed', tone: 'overdue' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  returned: { label: 'Returned', tone: 'neutral' },
};

// Tailwind-ready classes per tone, driven by the CSS variables.
export const TONE_CLASSES = {
  delivered: 'text-[hsl(var(--status-delivered))] bg-[hsl(var(--status-delivered-bg))]',
  transit: 'text-[hsl(var(--status-transit))] bg-[hsl(var(--status-transit-bg))]',
  soon: 'text-[hsl(var(--status-soon))] bg-[hsl(var(--status-soon-bg))]',
  overdue: 'text-[hsl(var(--status-overdue))] bg-[hsl(var(--status-overdue-bg))]',
  neutral: 'text-[hsl(var(--status-neutral))] bg-[hsl(var(--status-neutral-bg))]',
};

export function statusChip(status) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'neutral' };
  return { label: meta.label, className: TONE_CLASSES[meta.tone] };
}

// Progress percent from ordered_at to promised_date, clamped 2-100.
export function progressPercent(orderedAt, promisedDate) {
  if (!orderedAt || !promisedDate) return null;
  const start = Date.parse(orderedAt);
  const end = new Date(`${promisedDate.slice(0, 10)}T23:59:59`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const pct = ((Date.now() - start) / (end - start)) * 100;
  return Math.min(100, Math.max(2, Math.round(pct)));
}
