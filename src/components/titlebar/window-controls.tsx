import { Copy, Minus, Square, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { CaptionGlyph } from '@/components/titlebar/caption-glyph';
import type { WindowControls as WindowControlsState } from '@/hooks/use-window-controls';
import { cn } from '@/lib/cn';
import { getDesktopPlatform } from '@/lib/platform';

interface CaptionButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'close';
  children: ReactNode;
}

function CaptionButton({ label, onClick, variant = 'default', children }: CaptionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        // Edge-to-edge native-style caption buttons: full height, no gaps, no rounding.
        'inline-flex h-full w-[46px] cursor-default items-center justify-center text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset',
        variant === 'close' &&
          'hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-destructive/60',
      )}
    >
      {children}
    </button>
  );
}

/** Windows/Linux style caption buttons for the custom title bar. */
export function WindowControls({
  isMaximized,
  minimize,
  toggleMaximize,
  close,
}: WindowControlsState) {
  const isWindows = getDesktopPlatform() === 'windows';
  const maximizeLabel = isMaximized ? 'Восстановить окно' : 'Развернуть окно';

  return (
    <div className="flex h-full items-stretch">
      <CaptionButton label="Свернуть окно" onClick={() => void minimize()}>
        {isWindows ? (
          <CaptionGlyph kind="minimize" />
        ) : (
          <Minus className="size-3.5" aria-hidden="true" />
        )}
      </CaptionButton>
      <CaptionButton label={maximizeLabel} onClick={() => void toggleMaximize()}>
        {isWindows ? (
          <CaptionGlyph kind={isMaximized ? 'restore' : 'maximize'} />
        ) : isMaximized ? (
          <Copy className="size-3" aria-hidden="true" />
        ) : (
          <Square className="size-3" aria-hidden="true" />
        )}
      </CaptionButton>
      <CaptionButton label="Закрыть окно" variant="close" onClick={() => void close()}>
        {isWindows ? <CaptionGlyph kind="close" /> : <X className="size-3.5" aria-hidden="true" />}
      </CaptionButton>
    </div>
  );
}
