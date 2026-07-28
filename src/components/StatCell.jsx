// Lifted out of Dashboard so the Refunds page tile (2.5) can share the same
// manifest-strip anatomy. The stats read as ONE card cut into label fields by
// dashed rules, the way a shipping label separates its data blocks. Divider
// classes are static per cell (2x2 on mobile, 1x4 on desktop) so Tailwind can
// see them.
export const STAT_DIVIDERS = [
  'border-e border-b lg:border-b-0 border-dashed',
  'border-b lg:border-b-0 lg:border-e border-dashed',
  'border-e border-dashed',
  '',
];

export default function StatCell({ label, value, tone, sub, dividers }) {
  return (
    <div className={`px-4 py-3.5 ${dividers}`}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`font-display font-extrabold text-[26px] leading-none tracking-tight tabular-nums mt-1.5 ${tone ?? ''}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
    </div>
  );
}
