import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  DEFAULT_THEME_PREFERENCE,
  applyTheme,
  getSystemTheme,
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  SYSTEM_THEME_QUERY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

function subscribeToSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(SYSTEM_THEME_QUERY);
  media.addEventListener('change', onChange);

  return () => {
    media.removeEventListener('change', onChange);
  };
}

function getSystemSnapshot(): ResolvedTheme {
  return getSystemTheme();
}

function getServerSnapshot(): ResolvedTheme {
  return 'dark';
}

export interface ThemeController {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  cycle: () => void;
}

/**
 * Theme state shared through a tiny external store, so the title bar toggle and
 * the settings page always show the same value.
 */
export function useTheme(): ThemeController {
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    () => DEFAULT_THEME_PREFERENCE,
  );
  const systemTheme = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemSnapshot,
    getServerSnapshot,
  );
  const resolved: ResolvedTheme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setThemePreference(next);
  }, []);

  const cycle = useCallback(() => {
    const current = getThemePreference();

    if (current === 'light') {
      setThemePreference('dark');
    } else if (current === 'dark') {
      setThemePreference('system');
    } else {
      setThemePreference('light');
    }
  }, []);

  return { preference, resolved, setPreference, cycle };
}
