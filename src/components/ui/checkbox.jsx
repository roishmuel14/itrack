import { forwardRef } from 'react';
import { Check } from 'lucide-react';

const Checkbox = forwardRef(({ className = '', checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={() => onCheckedChange?.(!checked)}
    className={`h-4 w-4 shrink-0 rounded border border-input flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'} ${className}`}
    {...props}
  >
    {checked && <Check className="h-3 w-3" />}
  </button>
));

Checkbox.displayName = 'Checkbox';

export { Checkbox };
