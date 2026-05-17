import type { Note } from '@/types';

// Parse [[wiki-style]] links from note content
export const extractNoteLinks = (content: string): string[] => {
  const regex = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
};

// Find notes that link to a given note
export const findBacklinks = (noteId: string, notes: Note[]): Note[] => {
  const targetNote = notes.find(n => n.id === noteId);
  if (!targetNote) return [];

  return notes.filter(n => {
    if (n.id === noteId || n.trashed) return false;
    const links = extractNoteLinks(n.content);
    return links.some(link => 
      link.toLowerCase() === targetNote.title.toLowerCase() ||
      n.linkedNoteIds.includes(noteId)
    );
  });
};

// Convert [[links]] to clickable elements in content (for rendering)
export const processNoteLinks = (
  content: string,
  notes: Note[]
): { processedContent: string; linkedIds: string[] } => {
  const linkedIds: string[] = [];
  
  const processedContent = content.replace(/\[\[([^\]]+)\]\]/g, (_, linkText) => {
    const linkedNote = notes.find(n => 
      !n.trashed && n.title.toLowerCase() === linkText.toLowerCase()
    );
    
    if (linkedNote) {
      linkedIds.push(linkedNote.id);
      // Return a marker that can be replaced with actual clickable element
      return `[[LINK:${linkedNote.id}:${linkText}]]`;
    }
    
    // Broken link - note doesn't exist
    return `[[BROKEN:${linkText}]]`;
  });

  return { processedContent, linkedIds };
};

// Insert a note link at cursor position
export const insertNoteLink = (
  content: string,
  cursorPosition: number,
  noteTitle: string
): { newContent: string; newCursorPosition: number } => {
  const link = `[[${noteTitle}]]`;
  const newContent = content.slice(0, cursorPosition) + link + content.slice(cursorPosition);
  return {
    newContent,
    newCursorPosition: cursorPosition + link.length,
  };
};

// Get suggestions for auto-complete when typing [[
export const getNoteSuggestions = (
  query: string,
  notes: Note[],
  excludeId?: string
): Note[] => {
  if (!query) return notes.filter(n => !n.trashed && n.id !== excludeId).slice(0, 10);
  
  const lowerQuery = query.toLowerCase();
  return notes
    .filter(n => 
      !n.trashed && 
      n.id !== excludeId &&
      (n.title.toLowerCase().includes(lowerQuery) ||
       n.content.toLowerCase().includes(lowerQuery))
    )
    .slice(0, 10);
};
