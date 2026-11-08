/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a portal modal with explicit focus handling; native <dialog> behaves inconsistently in the Tauri WebView */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | null | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
}

/**
 * Accessible modal rendered into a portal: Escape closes it, focus moves into
 * the panel, and the backdrop never steals clicks from the dialog itself.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  tone = 'default',
  className,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const focusTimer = setTimeout(() => {
      panelRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full max-w-lg rounded-xl border bg-popover text-popover-foreground shadow-2xl outline-none',
          tone === 'danger' ? 'border-destructive/40' : 'border-border/80',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 id={titleId} className="text-sm font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="text-xs leading-5 text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {children && <div className="px-5 py-4">{children}</div>}

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
