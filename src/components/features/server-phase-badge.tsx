import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { SERVER_PHASE_LABELS, getPhaseTone, type PhaseTone } from '@/lib/status';
import type { ServerPhase } from '@/lib/types';

const PHASE_VARIANTS: Record<PhaseTone, BadgeVariant> = {
  neutral: 'outline',
  active: 'warning',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const PHASE_DOTS: Record<PhaseTone, string> = {
  neutral: 'bg-muted-foreground/60',
  active: 'animate-pulse bg-warning',
  success: 'bg-success status-glow',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export interface ServerPhaseBadgeProps {
  phase: ServerPhase | null;
  className?: string;
}

/** Small localized pill for the server lifecycle phase. */
export function ServerPhaseBadge({ phase, className }: ServerPhaseBadgeProps) {
  const tone = getPhaseTone(phase);

  return (
    <Badge variant={PHASE_VARIANTS[tone]} className={cn('gap-1.5', className)}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', PHASE_DOTS[tone])} />
      {phase ? SERVER_PHASE_LABELS[phase] : 'Нет данных'}
    </Badge>
  );
}
