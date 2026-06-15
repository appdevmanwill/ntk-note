import type { Note } from '@/types';

export type NoteExportFormat = 'pdf' | 'print' | 'plain' | 'markdown' | 'html' | 'email';

export interface NoteExportOptions {
  includeTitle: boolean;
  includeDates: boolean;
  includeTags: boolean;
}

export const defaultNoteExportOptions: NoteExportOptions = {
  includeTitle: true,
  includeDates: true,
  includeTags: true,
};

export const NOTE_EXPORT_OPTIONS_KEY = 'ntk-note-export-options';
export const NOTE_LAST_EXPORT_FORMAT_KEY = 'ntk-note-last-export-format';

export const loadNoteExportOptions = (): NoteExportOptions => {
  try {
    const raw = localStorage.getItem(NOTE_EXPORT_OPTIONS_KEY);
    return raw ? { ...defaultNoteExportOptions, ...JSON.parse(raw) } : defaultNoteExportOptions;
  } catch {
    return defaultNoteExportOptions;
  }
};

export const saveNoteExportOptions = (options: NoteExportOptions) => {
  localStorage.setItem(NOTE_EXPORT_OPTIONS_KEY, JSON.stringify(options));
};

export const loadLastExportFormat = (): NoteExportFormat | null => {
  const raw = localStorage.getItem(NOTE_LAST_EXPORT_FORMAT_KEY) as NoteExportFormat | null;
  return raw && ['pdf', 'print', 'plain', 'markdown', 'html', 'email'].includes(raw) ? raw : null;
};

export const saveLastExportFormat = (format: NoteExportFormat) => {
  localStorage.setItem(NOTE_LAST_EXPORT_FORMAT_KEY, format);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const safeFileName = (value: string) =>
  (value || 'note')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'note';

const dateLine = (note: Note) =>
  `Created: ${new Date(note.createdAt).toLocaleDateString()} | Modified: ${new Date(note.updatedAt).toLocaleDateString()}`;

const checklistPlainText = (note: Note) =>
  note.checklist.map(item => `${item.checked ? '[x]' : '[ ]'} ${item.text}`).join('\n');

const buildPlainText = (note: Note, options: NoteExportOptions) => {
  const sections: string[] = [];
  if (options.includeTitle) sections.push(note.title || 'Untitled');
  if (options.includeDates) sections.push(dateLine(note));
  if (options.includeTags && note.tags.length > 0) sections.push(`Tags: ${note.tags.join(', ')}`);
  if (note.content) sections.push(note.content);
  if (note.checklist.length > 0) sections.push(checklistPlainText(note));
  return sections.join('\n\n');
};

const buildMarkdown = (note: Note, options: NoteExportOptions) => {
  const sections: string[] = [];
  if (options.includeTitle) sections.push(`# ${note.title || 'Untitled'}`);
  if (options.includeDates) sections.push(`_${dateLine(note)}_`);
  if (options.includeTags && note.tags.length > 0) sections.push(note.tags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' '));
  if (note.content) sections.push(note.content);
  if (note.checklist.length > 0) {
    sections.push(note.checklist.map(item => `- [${item.checked ? 'x' : ' '}] ${item.text}`).join('\n'));
  }
  return sections.join('\n\n');
};

const buildHtml = (note: Note, options: NoteExportOptions) => {
  const sections: string[] = [];
  if (options.includeTitle) sections.push(`<h1>${escapeHtml(note.title || 'Untitled')}</h1>`);
  if (options.includeDates) sections.push(`<p class="meta">${escapeHtml(dateLine(note))}</p>`);
  if (options.includeTags && note.tags.length > 0) {
    sections.push(`<p class="tags">${note.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</p>`);
  }
  if (note.content) sections.push(`<div class="content">${escapeHtml(note.content).replace(/\n/g, '<br>')}</div>`);
  if (note.checklist.length > 0) {
    sections.push(`<ul class="checklist">${note.checklist.map(item =>
      `<li><input type="checkbox" ${item.checked ? 'checked' : ''} disabled> <span>${escapeHtml(item.text)}</span></li>`
    ).join('')}</ul>`);
  }
  return sections.join('\n');
};

export const exportToPDF = async (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth() - 2 * margin;
  let y = margin;

  if (options.includeTitle) {
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    const titleLines = doc.splitTextToSize(note.title || 'Untitled', pageWidth);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 10 + 5;
  }

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128, 128, 128);

  if (options.includeDates) {
    doc.text(dateLine(note), margin, y);
    y += 8;
  }

  if (options.includeTags && note.tags.length > 0) {
    doc.text(`Tags: ${note.tags.join(', ')}`, margin, y);
    y += 8;
  }

  if (options.includeTitle || options.includeDates || (options.includeTags && note.tags.length > 0)) {
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, margin + pageWidth, y);
    y += 8;
  }

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');

  const lines = doc.splitTextToSize(note.content || '', pageWidth);

  for (const line of lines) {
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 6;
  }

  if (note.checklist.length > 0) {
    y += 4;
    for (const item of note.checklist) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(`${item.checked ? '[x]' : '[ ]'} ${item.text}`, margin, y);
      y += 6;
    }
  }

  doc.save(`${safeFileName(note.title)}.pdf`);
};

export const copyAsPlainText = (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  navigator.clipboard.writeText(buildPlainText(note, options));
};

export const copyAsMarkdown = (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  navigator.clipboard.writeText(buildMarkdown(note, options));
};

export const copyAsHTML = (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  navigator.clipboard.writeText(buildHtml(note, options));
};

export const shareViaEmail = (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  const subject = encodeURIComponent(note.title || 'Shared Note');
  const body = encodeURIComponent(buildPlainText(note, options));
  window.open(`mailto:?subject=${subject}&body=${body}`);
};

export const generateShareLink = (note: Note): string => {
  const data = btoa(JSON.stringify({ title: note.title, content: note.content, checklist: note.checklist }));
  return `${window.location.origin}?shared=${data.slice(0, 50)}...`;
};

export const printNote = (note: Note, options: NoteExportOptions = defaultNoteExportOptions) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(note.title || 'Note')}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 40px auto;
          padding: 20px;
          color: #1a1a1a;
          line-height: 1.6;
        }
        h1 { margin-bottom: 8px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 16px; }
        .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 20px; }
        .tags span { background: #eef2ff; color: #4f46e5; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
        .content { white-space: pre-wrap; margin-top: 20px; }
        .checklist { list-style: none; padding: 0; margin-top: 20px; }
        .checklist li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
        @media print {
          body { margin: 0; padding: 20px; }
        }
      </style>
    </head>
    <body>
      ${buildHtml(note, options)}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
};
