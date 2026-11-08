import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

/** CSS-only tooltip shown on hover and keyboard focus. */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md border border-border/80 bg-popover px-2 py-1 text-[11px] leading-4 font-medium whitespace-nowrap text-popover-foreground opacity-0 shadow-lg transition-opacity',
          'group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100',
        )}
      >
        {content}
      </span>
    </span>
  );
}
