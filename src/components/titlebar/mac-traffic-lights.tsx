import { Maximize2, Minus, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { WindowControls as WindowControlsState } from '@/hooks/use-window-controls';
import { cn } from '@/lib/cn';

interface TrafficLightProps {
  label: string;
  tone: 'close' | 'minimize' | 'zoom';
  onClick: () => void;
  children: ReactNode;
}

function TrafficLight({ label, tone, onClick, children }: TrafficLightProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'group/traffic relative inline-flex size-3 cursor-default items-center justify-center rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        tone === 'close' && 'bg-[#ff5f57]',
        tone === 'minimize' && 'bg-[#febc2e]',
        tone === 'zoom' && 'bg-[#28c840]',
      )}
    >
      <span className="text-black/60 opacity-0 transition-opacity group-hover/traffic:opacity-100">
        {children}
      </span>
    </button>
  );
}

/**
 * macOS style traffic lights for the left edge of the custom title bar.
 * Glyphs appear on hover, matching the native macOS behaviour.
 */
export function TrafficLights({
  isMaximized,
  minimize,
  toggleMaximize,
  close,
}: WindowControlsState) {
  return (
    <div className="flex items-center gap-2 pl-3">
      <TrafficLight label="Закрыть окно" tone="close" onClick={() => void close()}>
        <X className="size-2" strokeWidth={3.5} aria-hidden="true" />
      </TrafficLight>
      <TrafficLight label="Свернуть окно" tone="minimize" onClick={() => void minimize()}>
        <Minus className="size-2" strokeWidth={3.5} aria-hidden="true" />
      </TrafficLight>
      <TrafficLight
        label={isMaximized ? 'Восстановить окно' : 'Развернуть окно'}
        tone="zoom"
        onClick={() => void toggleMaximize()}
      >
        <Maximize2 className="size-2" strokeWidth={3.5} aria-hidden="true" />
      </TrafficLight>
    </div>
  );
}
