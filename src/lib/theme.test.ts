import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyTheme,
  DEFAULT_THEME_PREFERENCE,
  getStoredTheme,
  initTheme,
  isThemePreference,
  storeTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

describe('theme preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('validates known preferences', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('neon')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('defaults to the Valheim dark theme when nothing is stored', () => {
    expect(getStoredTheme()).toBe(DEFAULT_THEME_PREFERENCE);
    expect(getStoredTheme()).toBe('dark');
  });

  it('persists and restores a preference', () => {
    storeTheme('light');

    expect(THEME_STORAGE_KEY).toBe('valheim:theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(getStoredTheme()).toBe('light');
  });

  it('ignores invalid stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'broken');

    expect(getStoredTheme()).toBe('dark');
  });

  it('applies the theme to the document root', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset['theme']).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('initializes from the stored preference and falls back to dark', () => {
    initTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    storeTheme('light');
    initTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
