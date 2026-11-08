import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

/** Multiline text input for advanced settings (extra launch arguments, labels). */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full resize-y rounded-md border border-input bg-background/70 px-3 py-2 font-mono text-xs leading-5 shadow-xs transition-colors outline-none',
        'placeholder:text-muted-foreground/70',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
