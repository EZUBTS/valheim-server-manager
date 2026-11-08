import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';

import type { WindowResizeDirection } from '@/lib/window';

function currentWindow() {
  return isTauri() ? getCurrentWindow() : null;
}

export interface WindowControls {
  isMaximized: boolean;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  startResizeDragging: (direction: WindowResizeDirection) => Promise<void>;
}

/**
 * Window chrome controls backed by the Tauri window API.
 *
 * Keeps the maximize/restore state in sync with OS-driven changes (snap,
 * keyboard shortcuts, double-click on the title bar) via the `resized` event.
 */
export function useWindowControls(): WindowControls {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = currentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncMaximized = async () => {
      if (!appWindow) {
        return;
      }

      try {
        const maximized = await appWindow.isMaximized();

        if (!disposed) {
          setIsMaximized(maximized);
        }
      } catch {
        // The window can disappear while the app is closing; nothing to sync.
      }
    };

    const subscribe = async () => {
      if (!appWindow) {
        return;
      }

      try {
        const stopListening = await appWindow.onResized(() => {
          void syncMaximized();
        });

        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      } catch {
        // Event subscription is a progressive enhancement for the buttons.
      }
    };

    void syncMaximized();
    void subscribe();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const minimize = useCallback(async () => {
    await currentWindow()?.minimize();
  }, []);

  const toggleMaximize = useCallback(async () => {
    await currentWindow()?.toggleMaximize();
  }, []);

  const close = useCallback(async () => {
    await currentWindow()?.close();
  }, []);

  const startResizeDragging = useCallback(async (direction: WindowResizeDirection) => {
    await currentWindow()?.startResizeDragging(direction);
  }, []);

  return { isMaximized, minimize, toggleMaximize, close, startResizeDragging };
}
