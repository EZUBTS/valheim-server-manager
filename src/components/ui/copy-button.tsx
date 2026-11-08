import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

/** Copies a value to the clipboard and briefly confirms it. */
export function CopyButton({ value, label = 'Копировать', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard?.writeText(value);
            setCopied(true);

            if (timerRef.current !== null) {
              clearTimeout(timerRef.current);
            }

            timerRef.current = setTimeout(() => {
              setCopied(false);
            }, 1600);
          } catch {
            // Clipboard access can be denied; the value stays selectable.
          }
        })();
      }}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
