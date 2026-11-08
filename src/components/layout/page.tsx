import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageContentProps {
  children: ReactNode;
  className?: string;
}

/** Centered content column shared by every page. */
export function PageContent({ children, className }: PageContentProps) {
  return (
    <div className={cn('mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6', className)}>
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  description: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, badge, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border/50 pb-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-[22px] leading-7 font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {badge}
        </div>
        <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export interface PageSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Titled block inside a page (mostly used for plain sections outside cards). */
export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: PageSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
