import type { NoteColor, ThemeAccent, Priority } from '@/types';

export const noteColors: Record<NoteColor, { bg: string; bgDark: string; border: string; borderDark: string; label: string; dot: string }> = {
  default: { bg: 'bg-white', bgDark: 'bg-surface-800', border: 'border-surface-200', borderDark: 'border-surface-700', label: 'Default', dot: 'bg-surface-400' },
  red: { bg: 'bg-red-50', bgDark: 'bg-red-950/40', border: 'border-red-200', borderDark: 'border-red-800/50', label: 'Red', dot: 'bg-red-500' },
  orange: { bg: 'bg-orange-50', bgDark: 'bg-orange-950/40', border: 'border-orange-200', borderDark: 'border-orange-800/50', label: 'Orange', dot: 'bg-orange-500' },
  yellow: { bg: 'bg-yellow-50', bgDark: 'bg-yellow-950/40', border: 'border-yellow-200', borderDark: 'border-yellow-800/50', label: 'Yellow', dot: 'bg-yellow-500' },
  green: { bg: 'bg-green-50', bgDark: 'bg-green-950/40', border: 'border-green-200', borderDark: 'border-green-800/50', label: 'Green', dot: 'bg-green-500' },
  teal: { bg: 'bg-teal-50', bgDark: 'bg-teal-950/40', border: 'border-teal-200', borderDark: 'border-teal-800/50', label: 'Teal', dot: 'bg-teal-500' },
  blue: { bg: 'bg-blue-50', bgDark: 'bg-blue-950/40', border: 'border-blue-200', borderDark: 'border-blue-800/50', label: 'Blue', dot: 'bg-blue-500' },
  purple: { bg: 'bg-purple-50', bgDark: 'bg-purple-950/40', border: 'border-purple-200', borderDark: 'border-purple-800/50', label: 'Purple', dot: 'bg-purple-500' },
  pink: { bg: 'bg-pink-50', bgDark: 'bg-pink-950/40', border: 'border-pink-200', borderDark: 'border-pink-800/50', label: 'Pink', dot: 'bg-pink-500' },
  brown: { bg: 'bg-amber-50', bgDark: 'bg-amber-950/40', border: 'border-amber-200', borderDark: 'border-amber-800/50', label: 'Brown', dot: 'bg-amber-700' },
  gray: { bg: 'bg-gray-100', bgDark: 'bg-gray-800/60', border: 'border-gray-200', borderDark: 'border-gray-700', label: 'Gray', dot: 'bg-gray-500' },
  indigo: { bg: 'bg-indigo-50', bgDark: 'bg-indigo-950/40', border: 'border-indigo-200', borderDark: 'border-indigo-800/50', label: 'Indigo', dot: 'bg-indigo-500' },
};

export const accentColors: Record<ThemeAccent, { primary: string; hover: string; ring: string; text: string; bg: string; bgLight: string }> = {
  indigo: { primary: 'bg-indigo-600', hover: 'hover:bg-indigo-700', ring: 'ring-indigo-500', text: 'text-indigo-600', bg: 'bg-indigo-500', bgLight: 'bg-indigo-100' },
  blue: { primary: 'bg-blue-600', hover: 'hover:bg-blue-700', ring: 'ring-blue-500', text: 'text-blue-600', bg: 'bg-blue-500', bgLight: 'bg-blue-100' },
  purple: { primary: 'bg-purple-600', hover: 'hover:bg-purple-700', ring: 'ring-purple-500', text: 'text-purple-600', bg: 'bg-purple-500', bgLight: 'bg-purple-100' },
  pink: { primary: 'bg-pink-600', hover: 'hover:bg-pink-700', ring: 'ring-pink-500', text: 'text-pink-600', bg: 'bg-pink-500', bgLight: 'bg-pink-100' },
  red: { primary: 'bg-red-600', hover: 'hover:bg-red-700', ring: 'ring-red-500', text: 'text-red-600', bg: 'bg-red-500', bgLight: 'bg-red-100' },
  orange: { primary: 'bg-orange-600', hover: 'hover:bg-orange-700', ring: 'ring-orange-500', text: 'text-orange-600', bg: 'bg-orange-500', bgLight: 'bg-orange-100' },
  amber: { primary: 'bg-amber-600', hover: 'hover:bg-amber-700', ring: 'ring-amber-500', text: 'text-amber-600', bg: 'bg-amber-500', bgLight: 'bg-amber-100' },
  emerald: { primary: 'bg-emerald-600', hover: 'hover:bg-emerald-700', ring: 'ring-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-500', bgLight: 'bg-emerald-100' },
  teal: { primary: 'bg-teal-600', hover: 'hover:bg-teal-700', ring: 'ring-teal-500', text: 'text-teal-600', bg: 'bg-teal-500', bgLight: 'bg-teal-100' },
  cyan: { primary: 'bg-cyan-600', hover: 'hover:bg-cyan-700', ring: 'ring-cyan-500', text: 'text-cyan-600', bg: 'bg-cyan-500', bgLight: 'bg-cyan-100' },
  violet: { primary: 'bg-violet-600', hover: 'hover:bg-violet-700', ring: 'ring-violet-500', text: 'text-violet-600', bg: 'bg-violet-500', bgLight: 'bg-violet-100' },
  rose: { primary: 'bg-rose-600', hover: 'hover:bg-rose-700', ring: 'ring-rose-500', text: 'text-rose-600', bg: 'bg-rose-500', bgLight: 'bg-rose-100' },
};

export const priorityConfig: Record<Priority, { color: string; bg: string; label: string; icon: string }> = {
  urgent: { color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', label: 'Urgent', icon: '🔴' },
  high: { color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30', label: 'High', icon: '🟠' },
  medium: { color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', label: 'Medium', icon: '🟡' },
  low: { color: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', label: 'Low', icon: '🟢' },
};

export const getNoteColorClasses = (color: NoteColor, isDark: boolean) => {
  const c = noteColors[color];
  return {
    bg: isDark ? c.bgDark : c.bg,
    border: isDark ? c.borderDark : c.border,
  };
};
