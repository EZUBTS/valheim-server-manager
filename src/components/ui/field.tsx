import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface FieldProps {
  label: string;
  htmlFor?: string;
  /** Inline validation message; when set the field is announced as invalid. */
  error?: string | null | undefined;
  hint?: string | null | undefined;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

/** Label + hint + error wrapper for form controls. */
export function Field({ label, htmlFor, error, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
      {error && (
        <p className="text-[11px] leading-4 text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
