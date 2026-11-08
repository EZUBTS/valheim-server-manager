/* oxlint-disable jsx-a11y/prefer-tag-over-role -- custom progress bar with an indeterminate sheen; native <progress> cannot be styled consistently in the WebView */
import { cn } from '@/lib/cn';
import { clampPercent, formatPercent } from '@/lib/format';

export interface ProgressProps {
  /** 0–100 or `null` for an indeterminate bar. */
  value: number | null;
  className?: string;
  tone?: 'primary' | 'success';
  label?: string;
}

/** Determinate/indeterminate progress bar with an accessible name. */
export function Progress({ value, className, tone = 'primary', label }: ProgressProps) {
  const determinate = value !== null;
  const width = determinate ? clampPercent(value) : 35;

  return (
    <div
      role="progressbar"
      aria-label={label ?? 'Прогресс операции'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(width) : undefined}
      aria-valuetext={determinate ? formatPercent(width) : 'Выполняется…'}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          tone === 'primary' ? 'bg-primary' : 'bg-success',
          !determinate && 'progress-sheen animate-pulse',
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
