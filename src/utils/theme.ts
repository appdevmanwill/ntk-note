import type { ThemeMode } from '@/types';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Resolves the persisted theme preference to a concrete theme.
 * 'system' follows the OS via prefers-color-scheme.
 */
export const resolveThemeMode = (theme: ThemeMode): ResolvedTheme => {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
