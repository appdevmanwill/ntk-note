import type { Note } from '@/types';

export const FIRESTORE_DOCUMENT_SOFT_LIMIT_BYTES = 900_000;

const encoder = new TextEncoder();

export const estimateBytes = (value: unknown) =>
  encoder.encode(JSON.stringify(value)).length;

export const estimateNoteBytes = (note: Note) => estimateBytes(note);

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const getStorageHeavyNotes = (notes: Note[], limit = 8) =>
  notes
    .map(note => ({ note, bytes: estimateNoteBytes(note) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);

export const getOversizedNotes = (notes: Note[]) =>
  getStorageHeavyNotes(notes, notes.length).filter(item => item.bytes >= FIRESTORE_DOCUMENT_SOFT_LIMIT_BYTES);

export const countInlineImages = (content: string) =>
  (content.match(/data:image\/[^;]+;base64,/g) || []).length;
