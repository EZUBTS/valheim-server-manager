import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';

import { cn } from '@/lib/cn';
import { useServer } from '@/hooks/use-server';
import type { ToastMessage, ToastTone } from '@/providers/server-context';

interface ToneMeta {
  icon: typeof CircleCheck;
  iconClassName: string;
}

const TONES: Record<ToastTone, ToneMeta> = {
  success: { icon: CircleCheck, iconClassName: 'text-success' },
  error: { icon: CircleAlert, iconClassName: 'text-destructive' },
  warning: { icon: TriangleAlert, iconClassName: 'text-warning' },
  info: { icon: Info, iconClassName: 'text-muted-foreground' },
};

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const meta = TONES[toast.tone];
  const Icon = meta.icon;

  useEffect(() => {
    const duration = toast.tone === 'error' ? 9000 : 5000;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border/80 bg-popover/95 p-3 text-popover-foreground shadow-xl backdrop-blur">
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.iconClassName)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-semibold">{toast.title}</p>
        {toast.description && (
          <p className="text-[11px] leading-4 break-words text-muted-foreground">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Скрыть уведомление"
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Toast stack in the bottom-right corner, fed by the server store. */
export function ToastViewport() {
  const { toasts, dismissToast } = useServer();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-label="Уведомления"
      className="pointer-events-none fixed right-4 bottom-10 z-[60] flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
