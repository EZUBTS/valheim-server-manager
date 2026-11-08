import { isTauri } from '@tauri-apps/api/core';
import { error as logError } from '@tauri-apps/plugin-log';

/**
 * Forwards a message to the Rust log (and therefore to the console and the log
 * directory). Best-effort: logging must never break the application itself.
 */
export function logAppError(message: string): void {
  void logError(message).catch(() => undefined);
}

/**
 * Forwards uncaught frontend errors to the Rust log so production issues are
 * diagnosable.
 */
export function installGlobalErrorLogging(): void {
  if (!isTauri()) {
    return;
  }

  window.addEventListener('error', (event) => {
    logAppError(`Unhandled error: ${event.message}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    logAppError(`Unhandled rejection: ${String(event.reason)}`);
  });
}
