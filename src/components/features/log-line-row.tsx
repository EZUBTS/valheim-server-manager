import { cn } from '@/lib/cn';
import { LOG_LEVEL_LABELS, LOG_SOURCE_LABELS } from '@/lib/log-filter';
import { formatTime } from '@/lib/format';
import type { LogLevel, LogLine, LogSource } from '@/lib/types';

const LEVEL_TEXT: Record<LogLevel, string> = {
  debug: 'text-muted-foreground/80',
  info: 'text-foreground/90',
  warn: 'text-warning',
  error: 'text-destructive',
};

const LEVEL_BAR: Record<LogLevel, string> = {
  debug: 'bg-muted-foreground/30',
  info: 'bg-transparent',
  warn: 'bg-warning',
  error: 'bg-destructive',
};

const SOURCE_TAG: Record<LogSource, string> = {
  server: 'bg-primary/12 text-primary',
  steamcmd: 'bg-secondary text-secondary-foreground',
  app: 'bg-accent text-accent-foreground',
};

export interface LogLineRowProps {
  line: LogLine;
  /** Hide the timestamp column (compact dashboard preview). */
  hideTime?: boolean;
  /** Hide the source tag (compact dashboard preview). */
  hideSource?: boolean;
  className?: string;
}

/** One log line with a source tag, level color and monospace message. */
export function LogLineRow({ line, hideTime, hideSource, className }: LogLineRowProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-sm px-1.5 py-0.5 font-mono text-[11px] leading-5',
        line.level === 'error' && 'bg-destructive/5',
        line.level === 'warn' && 'bg-warning/5',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('mt-1.5 h-3 w-0.5 shrink-0 rounded-full', LEVEL_BAR[line.level])}
      />
      {!hideTime && (
        <span className="shrink-0 text-muted-foreground/70 tabular-nums">
          {formatTime(line.ts)}
        </span>
      )}
      {!hideSource && (
        <span
          className={cn(
            'mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold tracking-wide uppercase',
            SOURCE_TAG[line.source],
          )}
          title={LOG_SOURCE_LABELS[line.source]}
        >
          {LOG_SOURCE_LABELS[line.source]}
        </span>
      )}
      <span
        className={cn('min-w-0 break-words whitespace-pre-wrap', LEVEL_TEXT[line.level])}
        title={LOG_LEVEL_LABELS[line.level]}
      >
        {line.line}
      </span>
    </div>
  );
}
