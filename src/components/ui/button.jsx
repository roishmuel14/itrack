import { forwardRef } from 'react';

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 card-shadow',
  outline: 'border bg-card text-foreground hover:bg-muted',
  ghost: 'hover:bg-muted text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const Button = forwardRef(({ className = '', variant = 'default', size, ...props }, ref) => {
  const baseStyles =
    'inline-flex items-center justify-center rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';
  const variantStyles = VARIANTS[variant] ?? VARIANTS.default;
  const sizeStyles = size === 'icon' ? 'h-9 w-9' : 'h-9 px-4 py-2';

  return <button ref={ref} className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className}`} {...props} />;
});

Button.displayName = 'Button';

export { Button };
