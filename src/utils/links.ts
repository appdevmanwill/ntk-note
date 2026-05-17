import type { Note } from '@/types';

export const noteDisplayTitle = (note?: Pick<Note, 'title' | 'encrypted'>) => {
  if (!note) return 'Untitled';
  if (note.encrypted) return note.title || 'Locked note';
  return note.title || 'Untitled';
};

export const extractWikiLinks = (content: string) => {
  const links = new Set<string>();
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const value = match[1]?.trim();
    if (value) links.add(value.toLowerCase());
  }
  return links;
};

export const getOutgoingNoteIds = (note: Note, notes: Note[]) => {
  const linked = new Set(note.linkedNoteIds || []);
  if (!note.encrypted) {
    const titles = extractWikiLinks(note.content);
    notes.forEach(candidate => {
      const title = (candidate.title || '').trim().toLowerCase();
      if (candidate.id !== note.id && title && titles.has(title)) linked.add(candidate.id);
    });
  }
  return Array.from(linked).filter(id => notes.some(noteItem => noteItem.id === id));
};

export const getBacklinks = (targetId: string, notes: Note[]) =>
  notes.filter(note =>
    !note.trashed &&
    note.id !== targetId &&
    getOutgoingNoteIds(note, notes).includes(targetId)
  );

export const buildGraph = (notes: Note[]) => {
  const visibleNotes = notes.filter(note => !note.trashed);
  const edges = visibleNotes.flatMap(note =>
    getOutgoingNoteIds(note, visibleNotes)
      .filter(to => to !== note.id)
      .map(to => ({ from: note.id, to }))
  );

  return { nodes: visibleNotes, edges };
};
