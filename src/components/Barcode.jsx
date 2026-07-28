// Decorative barcode strip from the shipping-label brand language. Extracted
// from the landing hero so the dashboard header can carry the same mark.
const BARS = [3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2];

export default function Barcode({ className = '' }) {
  return (
    <span className={`flex h-5 items-end gap-[2px] ${className}`} aria-hidden="true">
      {BARS.map((w, i) => (
        <span key={i} className="h-full bg-foreground/70" style={{ width: `${w}px` }} />
      ))}
    </span>
  );
}
