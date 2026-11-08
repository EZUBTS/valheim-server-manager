export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'valheim:theme';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';
export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** Reads the persisted preference; Valheim's dark theme is the default. */
export function getStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persists the preference. Storage failures must never break theming. */
export function storeTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode or a locked-down webview: theming still works for the session.
  }
}

/** The theme currently preferred by the operating system. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light';
}

/** Applies the resolved theme to the document root. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;

  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.dataset['theme'] = theme;
}

// --- Tiny external store ---------------------------------------------------
// Theme is app-wide state: the title bar toggle, the settings page and the
// initial script must all agree, so every `useTheme()` subscribes here instead
// of keeping its own copy.

let cachedPreference: ThemePreference | null = null;
const listeners = new Set<() => void>();

/** Returns the current preference, reading storage on first access. */
export function getThemePreference(): ThemePreference {
  if (cachedPreference === null) {
    cachedPreference = getStoredTheme();
  }

  return cachedPreference;
}

/** Subscribes to theme changes; returns an unsubscribe function. */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Updates, persists and broadcasts the preference. */
export function setThemePreference(preference: ThemePreference): void {
  cachedPreference = preference;
  storeTheme(preference);

  for (const listener of listeners) {
    listener();
  }
}

/**
 * Applies the persisted theme before React renders so the hidden window is
 * revealed with the correct colors on the very first paint.
 */
export function initTheme(): void {
  cachedPreference = getStoredTheme();
  applyTheme(cachedPreference === 'system' ? getSystemTheme() : cachedPreference);
}
