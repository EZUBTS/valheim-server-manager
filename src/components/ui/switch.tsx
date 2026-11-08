import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export interface SwitchProps extends Omit<ComponentProps<'button'>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Accessible toggle switch (`role="switch"`), styled for the dark theme. */
export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onCheckedChange(!checked);
      }}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5 transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'justify-end border-primary bg-primary' : 'justify-start border-border bg-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-3.5 rounded-full shadow-sm transition-colors',
          checked ? 'bg-primary-foreground' : 'bg-muted-foreground/70',
        )}
      />
    </button>
  );
}
