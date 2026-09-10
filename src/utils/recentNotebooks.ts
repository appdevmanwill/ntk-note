import type { Notebook, Note } from '@/types';

export interface RecentNotebookItem {
  notebook: Notebook;
  noteCount: number;
  lastActivityTime: number;
  lastActivityIso: string;
}

/**
 * Computes recent notebooks ordered by latest updated active note inside,
 * falling back to the notebook creation timestamp if the notebook has no notes.
 * Excludes trashed notebooks and trashed notes.
 */
export function getRecentNotebooks(
  notebooks: Notebook[],
  notes: Note[],
  limit = 6
): RecentNotebookItem[] {
  const activeNotebooks = notebooks.filter(nb => !nb.trashed);

  const items: RecentNotebookItem[] = activeNotebooks.map(nb => {
    const activeNotes = notes.filter(n => n.notebookId === nb.id && !n.trashed);
    const noteCount = activeNotes.length;

    let lastActivityTime = new Date(nb.createdAt).getTime();
    if (Number.isNaN(lastActivityTime) || lastActivityTime <= 0) {
      lastActivityTime = Date.now();
    }

    if (activeNotes.length > 0) {
      for (const note of activeNotes) {
        const t = new Date(note.updatedAt || note.createdAt).getTime();
        if (!Number.isNaN(t) && t > lastActivityTime) {
          lastActivityTime = t;
        }
      }
    }

    return {
      notebook: nb,
      noteCount,
      lastActivityTime,
      lastActivityIso: new Date(lastActivityTime).toISOString(),
    };
  });

  return items
    .sort((a, b) => b.lastActivityTime - a.lastActivityTime)
    .slice(0, limit);
}
