import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'primary' | 'outline' | 'success' | 'warning' | 'danger';

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'border-transparent bg-muted text-muted-foreground',
  primary: 'border-transparent bg-primary/10 text-primary',
  outline: 'border-border/80 bg-transparent text-muted-foreground',
  success: 'border-transparent bg-success/12 text-success',
  warning: 'border-transparent bg-warning/15 text-warning',
  danger: 'border-transparent bg-destructive/12 text-destructive',
};

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant;
}

/** Small status/label pill used across the shell. */
export function Badge({ className, variant = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none font-medium',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
