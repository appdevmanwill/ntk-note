import type { Note } from '@/types';

export const exportToPDF = async (note: Note) => {
  // Dynamic imports to avoid loading heavy libs upfront
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  
  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth() - 2 * margin;
  let y = margin;
  
  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(note.title || 'Untitled', pageWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 10 + 5;
  
  // Metadata
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(128, 128, 128);
  doc.text(`Created: ${new Date(note.createdAt).toLocaleDateString()} | Modified: ${new Date(note.updatedAt).toLocaleDateString()}`, margin, y);
  y += 8;
  
  if (note.tags.length > 0) {
    doc.text(`Tags: ${note.tags.join(', ')}`, margin, y);
    y += 8;
  }
  
  // Divider
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, margin + pageWidth, y);
  y += 8;
  
  // Content
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  
  const content = note.content || '';
  const lines = doc.splitTextToSize(content, pageWidth);
  
  for (const line of lines) {
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += 6;
  }
  
  // Checklist items
  if (note.checklist.length > 0) {
    y += 4;
    for (const item of note.checklist) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      const prefix = item.checked ? '☑' : '☐';
      doc.text(`${prefix} ${item.text}`, margin, y);
      y += 6;
    }
  }
  
  doc.save(`${note.title || 'note'}.pdf`);
};

export const copyAsPlainText = (note: Note) => {
  let text = note.title + '\n\n' + note.content;
  if (note.checklist.length > 0) {
    text += '\n\n' + note.checklist.map(i => `${i.checked ? '[x]' : '[ ]'} ${i.text}`).join('\n');
  }
  navigator.clipboard.writeText(text);
};

export const copyAsMarkdown = (note: Note) => {
  let md = `# ${note.title}\n\n${note.content}`;
  if (note.checklist.length > 0) {
    md += '\n\n' + note.checklist.map(i => `- [${i.checked ? 'x' : ' '}] ${i.text}`).join('\n');
  }
  navigator.clipboard.writeText(md);
};

export const copyAsHTML = (note: Note) => {
  let html = `<h1>${note.title}</h1>\n<div>${note.content.replace(/\n/g, '<br>')}</div>`;
  if (note.checklist.length > 0) {
    html += '<ul>' + note.checklist.map(i =>
      `<li><input type="checkbox" ${i.checked ? 'checked' : ''} disabled> ${i.text}</li>`
    ).join('') + '</ul>';
  }
  navigator.clipboard.writeText(html);
};

export const shareViaEmail = (note: Note) => {
  const subject = encodeURIComponent(note.title || 'Shared Note');
  const body = encodeURIComponent(note.content + (note.checklist.length > 0
    ? '\n\n' + note.checklist.map(i => `${i.checked ? '✓' : '○'} ${i.text}`).join('\n')
    : ''));
  window.open(`mailto:?subject=${subject}&body=${body}`);
};

export const generateShareLink = (note: Note): string => {
  // In production, this would create a server-side shared link
  const data = btoa(JSON.stringify({ title: note.title, content: note.content, checklist: note.checklist }));
  return `${window.location.origin}?shared=${data.slice(0, 50)}...`;
};

export const printNote = (note: Note) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const checklistHtml = note.checklist.length > 0
    ? `<ul style="list-style: none; padding: 0; margin-top: 20px;">
        ${note.checklist.map(i => `
          <li style="display: flex; align-items: center; gap: 8px; padding: 4px 0;">
            <input type="checkbox" ${i.checked ? 'checked' : ''} disabled style="width: 16px; height: 16px;">
            <span style="${i.checked ? 'text-decoration: line-through; color: #888;' : ''}">${i.text}</span>
          </li>
        `).join('')}
      </ul>`
    : '';

  const tagsHtml = note.tags.length > 0
    ? `<div style="margin-top: 16px;">
        ${note.tags.map(t => `<span style="display: inline-block; background: #eef2ff; color: #4f46e5; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 4px;">${t}</span>`).join('')}
      </div>`
    : '';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${note.title || 'Note'}</title>
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
        .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
        .content { white-space: pre-wrap; }
        @media print {
          body { margin: 0; padding: 20px; }
        }
      </style>
    </head>
    <body>
      <h1>${note.title || 'Untitled'}</h1>
      <div class="meta">
        Created: ${new Date(note.createdAt).toLocaleDateString()} &bull; 
        Modified: ${new Date(note.updatedAt).toLocaleDateString()}
      </div>
      ${tagsHtml}
      <div class="content">${note.content.replace(/\n/g, '<br>')}</div>
      ${checklistHtml}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
};
