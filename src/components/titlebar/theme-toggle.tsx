import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';
import type { ThemePreference } from '@/lib/theme';

const NEXT_LABEL: Record<ThemePreference, string> = {
  light: 'Включить тёмную тему',
  dark: 'Следовать системной теме',
  system: 'Включить светлую тему',
};

/** Cycles the theme: light → dark → system. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, cycle } = useTheme();
  const Icon = preference === 'light' ? Sun : preference === 'dark' ? Moon : Monitor;

  return (
    <button
      type="button"
      aria-label={NEXT_LABEL[preference]}
      title={NEXT_LABEL[preference]}
      onClick={cycle}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}
