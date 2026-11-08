import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<NoticeTone, { container: string; icon: ReactNode }> = {
  info: {
    container: 'border-border/70 bg-muted/40 text-foreground',
    icon: <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
  },
  success: {
    container: 'border-success/30 bg-success/10 text-foreground',
    icon: <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />,
  },
  warning: {
    container: 'border-warning/35 bg-warning/10 text-foreground',
    icon: <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />,
  },
  danger: {
    container: 'border-destructive/35 bg-destructive/10 text-foreground',
    icon: <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />,
  },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Inline callout/alert used for hints, warnings and recoverable errors. */
export function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  const meta = TONES[tone];

  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
        meta.container,
        className,
      )}
    >
      {meta.icon}
      <div className="min-w-0 space-y-1 text-xs leading-5">
        {title && <p className="font-semibold text-foreground">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
