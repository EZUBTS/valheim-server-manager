import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Mirrors the `ResizeDirection` union accepted by
 * `@tauri-apps/api/window`'s `startResizeDragging` (not re-exported by the package).
 */
export type WindowResizeDirection =
  'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

/**
 * Reveals the main window once the first frame has been painted.
 *
 * The window is created hidden (`visible: false` in `tauri.conf.json`) so the
 * webview background never flashes white before React and Tailwind are ready.
 * The Rust side has a 2 second fallback in case this never runs.
 */
export async function revealMainWindow(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve();
      });
    });
  });

  try {
    await getCurrentWindow().show();
  } catch (error) {
    console.error('Failed to reveal the main window', error);
  }
}
