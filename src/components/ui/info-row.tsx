import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/** Compact key/value list used in settings and status cards. */
export function InfoList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('divide-y divide-border/60', className)} {...props} />;
}

export interface InfoRowProps {
  label: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
  title?: string | undefined;
}

export function InfoRow({ label, children, mono, className, title }: InfoRowProps) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2', className)}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        title={title}
        className={cn(
          'max-w-full min-w-0 text-right break-all text-foreground',
          mono ? 'font-mono text-[11px]' : 'text-xs font-medium',
        )}
      >
        {children}
      </dd>
    </div>
  );
}
