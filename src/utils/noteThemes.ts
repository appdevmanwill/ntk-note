import type { NoteTheme, ThemeAccent } from '@/types';

export const noteThemes: Record<NoteTheme, {
  label: string;
  description: string;
  accent: string;
  preview: string;
}> = {
  canvas: {
    label: 'Clean Canvas',
    description: 'Quiet white workspace for everyday notes',
    accent: '#4f46e5',
    preview: 'linear-gradient(135deg, #ffffff, #f4f7fb)',
  },
  parchment: {
    label: 'Warm Parchment',
    description: 'Soft editorial warmth for journals and planning',
    accent: '#b45309',
    preview: 'linear-gradient(135deg, #fff8eb, #f7ecd2)',
  },
  midnight: {
    label: 'Midnight Focus',
    description: 'Deep low-glare writing surface for late work',
    accent: '#818cf8',
    preview: 'linear-gradient(135deg, #151821, #252a3a)',
  },
  ocean: {
    label: 'Ocean Glass',
    description: 'Cool blue-green clarity for research and strategy',
    accent: '#0891b2',
    preview: 'linear-gradient(135deg, #ecfeff, #dbeafe)',
  },
  forest: {
    label: 'Forest Calm',
    description: 'Grounded green tone for thoughtful capture',
    accent: '#15803d',
    preview: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
  },
  sunset: {
    label: 'Sunset Coral',
    description: 'Warm energetic theme for ideas and campaigns',
    accent: '#ea580c',
    preview: 'linear-gradient(135deg, #fff1f2, #ffedd5)',
  },
  lavender: {
    label: 'Lavender Studio',
    description: 'Creative purple wash for drafts and concepts',
    accent: '#7c3aed',
    preview: 'linear-gradient(135deg, #faf5ff, #ede9fe)',
  },
  graphite: {
    label: 'Graphite Pro',
    description: 'Professional neutral theme for business notes',
    accent: '#475569',
    preview: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
  },
  mint: {
    label: 'Mint Fresh',
    description: 'Bright mint surface for checklists and routines',
    accent: '#0f766e',
    preview: 'linear-gradient(135deg, #f0fdfa, #d9f99d)',
  },
  rose: {
    label: 'Rose Quartz',
    description: 'Gentle rose theme for personal notes and reflections',
    accent: '#be185d',
    preview: 'linear-gradient(135deg, #fff1f2, #fce7f3)',
  },
};

export const accentPalette: Record<ThemeAccent, { primary: string; hover: string; rgb: string }> = {
  indigo: { primary: '#4f46e5', hover: '#4338ca', rgb: '79, 70, 229' },
  blue: { primary: '#2563eb', hover: '#1d4ed8', rgb: '37, 99, 235' },
  purple: { primary: '#9333ea', hover: '#7e22ce', rgb: '147, 51, 234' },
  pink: { primary: '#db2777', hover: '#be185d', rgb: '219, 39, 119' },
  red: { primary: '#dc2626', hover: '#b91c1c', rgb: '220, 38, 38' },
  orange: { primary: '#ea580c', hover: '#c2410c', rgb: '234, 88, 12' },
  amber: { primary: '#d97706', hover: '#b45309', rgb: '217, 119, 6' },
  emerald: { primary: '#059669', hover: '#047857', rgb: '5, 150, 105' },
  teal: { primary: '#0d9488', hover: '#0f766e', rgb: '13, 148, 136' },
  cyan: { primary: '#0891b2', hover: '#0e7490', rgb: '8, 145, 178' },
  violet: { primary: '#7c3aed', hover: '#6d28d9', rgb: '124, 58, 237' },
  rose: { primary: '#e11d48', hover: '#be123c', rgb: '225, 29, 72' },
};
