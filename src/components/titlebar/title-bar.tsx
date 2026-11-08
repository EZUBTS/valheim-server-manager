import { Monitor } from 'lucide-react';

import { Logo } from '@/components/brand/logo';
import { ServerPhaseBadge } from '@/components/features/server-phase-badge';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/titlebar/theme-toggle';
import { WindowControls } from '@/components/titlebar/window-controls';
import { TrafficLights } from '@/components/titlebar/mac-traffic-lights';
import type { WindowControls as WindowControlsState } from '@/hooks/use-window-controls';
import { PAGE_META, type PageId } from '@/lib/pages';
import { getDesktopPlatform } from '@/lib/platform';
import type { ServerPhase } from '@/lib/types';

export interface TitleBarProps {
  controls: WindowControlsState;
  page: PageId;
  phase: ServerPhase | null;
  isPreview: boolean;
}

/**
 * Fully custom title bar.
 *
 * `data-tauri-drag-region="deep"` makes the whole bar draggable through
 * Tauri's native window manager, which also provides double-click to
 * maximize/restore. Buttons are automatically excluded because Tauri treats
 * clickable elements as non-draggable.
 */
export function TitleBar({ controls, page, phase, isPreview }: TitleBarProps) {
  const isMac = getDesktopPlatform() === 'macos';

  return (
    <header
      data-tauri-drag-region="deep"
      className="relative z-20 flex h-10 shrink-0 items-center gap-2 border-b border-border/70 bg-background/85 backdrop-blur-xl select-none"
    >
      {isMac && <TrafficLights {...controls} />}

      <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-3">
        <Logo className="size-5" />
        <span className="font-display text-[13px] leading-none font-semibold tracking-wide">
          Valheim Server Manager
        </span>
        {isPreview && (
          <Badge variant="outline" className="hidden gap-1 md:inline-flex">
            <Monitor className="size-2.5" aria-hidden="true" />
            предпросмотр
          </Badge>
        )}
        <span className="mx-0.5 hidden h-3.5 w-px bg-border sm:block" aria-hidden="true" />
        <span className="hidden truncate text-xs font-medium text-muted-foreground sm:block">
          {PAGE_META[page].label}
        </span>
      </div>

      <div className="flex h-full items-stretch">
        <div className="flex items-center gap-1.5 px-1.5">
          <ServerPhaseBadge phase={phase} className="hidden sm:inline-flex" />
          <ThemeToggle />
        </div>
        {!isMac && <WindowControls {...controls} />}
      </div>
    </header>
  );
}
