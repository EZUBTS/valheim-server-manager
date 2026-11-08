import { cn } from '@/lib/cn';
import type { WindowResizeDirection } from '@/lib/window';

interface Handle {
  direction: WindowResizeDirection;
  className: string;
}

const HANDLES: readonly Handle[] = [
  { direction: 'North', className: 'top-0 right-2 left-2 h-1 cursor-ns-resize' },
  { direction: 'South', className: 'right-2 bottom-0 left-2 h-1 cursor-ns-resize' },
  { direction: 'West', className: 'top-2 bottom-2 left-0 w-1 cursor-ew-resize' },
  { direction: 'East', className: 'top-2 right-0 bottom-2 w-1 cursor-ew-resize' },
  { direction: 'NorthWest', className: 'top-0 left-0 z-10 size-2 cursor-nwse-resize' },
  { direction: 'NorthEast', className: 'top-0 right-0 z-10 size-2 cursor-nesw-resize' },
  { direction: 'SouthWest', className: 'bottom-0 left-0 z-10 size-2 cursor-nesw-resize' },
  { direction: 'SouthEast', className: 'right-0 bottom-0 z-10 size-2 cursor-nwse-resize' },
];

interface ResizeHandlesProps {
  onResizeStart: (direction: WindowResizeDirection) => Promise<void>;
}

/**
 * Invisible hit areas on all eight window edges.
 *
 * Frameless windows lose the native resize border on some platforms, so the
 * custom chrome explicitly starts a Tauri resize drag from the nearest edge.
 */
export function ResizeHandles({ onResizeStart }: ResizeHandlesProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-50">
      {HANDLES.map(({ direction, className }) => (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- pointer-only resize grip that mirrors the native window border
        <div
          key={direction}
          className={cn('pointer-events-auto absolute', className)}
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            void onResizeStart(direction);
          }}
        />
      ))}
    </div>
  );
}
