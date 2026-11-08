import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type MetricTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

const TONES: Record<MetricTone, string> = {
  default: 'border-border/70 bg-card/60',
  primary: 'border-primary/30 bg-primary/8',
  success: 'border-success/30 bg-success/8',
  warning: 'border-warning/35 bg-warning/8',
  danger: 'border-destructive/35 bg-destructive/8',
};

export interface MetricProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: MetricTone;
  className?: string;
}

/** Compact statistic tile for dashboards and status strips. */
export function Metric({ label, value, hint, icon, tone = 'default', className }: MetricProps) {
  return (
    <div className={cn('rounded-xl border px-3.5 py-3', TONES[tone], className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-1 text-lg leading-6 font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
      {hint && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}
