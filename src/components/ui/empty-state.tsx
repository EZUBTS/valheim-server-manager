import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string | null;
  action?: ReactNode;
  className?: string;
}

/** Friendly empty state with an optional runic watermark. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <span aria-hidden="true" className="rune-watermark text-lg select-none">
          ᚠ ᚢ ᚦ ᚨ
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
