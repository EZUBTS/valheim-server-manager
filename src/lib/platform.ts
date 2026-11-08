import { platform } from '@tauri-apps/plugin-os';

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

function detectFromUserAgent(): DesktopPlatform {
  if (typeof navigator === 'undefined') {
    return 'windows';
  }

  const { userAgent } = navigator;

  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return 'macos';
  }

  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) {
    return 'linux';
  }

  return 'windows';
}

/**
 * Resolves the desktop platform through the official `os` plugin.
 *
 * Falls back to the user agent when running in a plain browser (`pnpm dev`
 * without Tauri), which keeps the UI fully previewable.
 */
export function getDesktopPlatform(): DesktopPlatform {
  try {
    const value = platform();

    if (value === 'windows' || value === 'macos' || value === 'linux') {
      return value;
    }
  } catch {
    // The plugin is only available inside a Tauri webview.
  }

  return detectFromUserAgent();
}
