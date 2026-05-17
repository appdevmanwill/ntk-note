import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/store';
import { v4 as uuid } from 'uuid';
import {
  Upload, X, Check, AlertCircle,
  HelpCircle, Loader2, FolderOpen, Eye, FileText, BookOpen
} from 'lucide-react';
import type { Note, ChecklistItem } from '@/types';

interface ImportSource {
  id: string;
  name: string;
  icon: string;
  formats: string[];
  description: string;
  instructions: string;
  color: string;
}

const importSources: ImportSource[] = [
  {
    id: 'evernote',
    name: 'Evernote',
    icon: '🐘',
    formats: ['.enex', '.html'],
    description: 'Import your Evernote notes and notebooks',
    instructions: 'In Evernote: Right-click notebook → Export notes → Choose ENEX format',
    color: 'from-green-500 to-emerald-600',
  },
  {
    id: 'google-keep',
    name: 'Google Keep',
    icon: '📌',
    formats: ['.json', '.html'],
    description: 'Import notes from Google Keep via Takeout',
    instructions: 'Go to takeout.google.com → Select Keep → Download → Extract ZIP → Upload JSON',
    color: 'from-yellow-500 to-amber-600',
  },
  {
    id: 'onenote',
    name: 'Microsoft OneNote',
    icon: '📓',
    formats: ['.html', '.docx', '.md'],
    description: 'Import OneNote pages and sections',
    instructions: 'In OneNote: File → Export → Choose format (HTML recommended)',
    color: 'from-purple-500 to-violet-600',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: '⬛',
    formats: ['.md', '.html', '.csv'],
    description: 'Import Notion pages and databases',
    instructions: 'In Notion: ••• menu → Export → Markdown & CSV or HTML',
    color: 'from-gray-700 to-gray-900',
  },
  {
    id: 'simplenote',
    name: 'Simplenote',
    icon: '📝',
    formats: ['.json', '.txt'],
    description: 'Import Simplenote notes and tags',
    instructions: 'In Simplenote: Settings → Tools → Export notes → Download ZIP',
    color: 'from-blue-500 to-indigo-600',
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    icon: '💎',
    formats: ['.md'],
    description: 'Import Obsidian vault markdown files',
    instructions: 'Select your .md files from the vault folder',
    color: 'from-violet-600 to-purple-700',
  },
  {
    id: 'bear',
    name: 'Bear',
    icon: '🐻',
    formats: ['.md', '.txt', '.html'],
    description: 'Import Bear notes with tags',
    instructions: 'In Bear: File → Export Notes → Choose Markdown',
    color: 'from-red-500 to-rose-600',
  },
  {
    id: 'apple-notes',
    name: 'Apple Notes',
    icon: '🍎',
    formats: ['.html', '.txt'],
    description: 'Import from Apple Notes (macOS/iOS)',
    instructions: 'Select notes → File → Export as PDF/Text, or use third-party tools',
    color: 'from-orange-500 to-amber-600',
  },
  {
    id: 'roam',
    name: 'Roam Research',
    icon: '🔗',
    formats: ['.json', '.md'],
    description: 'Import Roam Research pages',
    instructions: 'In Roam: ••• → Export All → JSON or Markdown',
    color: 'from-blue-600 to-cyan-600',
  },
  {
    id: 'standard-notes',
    name: 'Standard Notes',
    icon: '🔒',
    formats: ['.json', '.txt'],
    description: 'Import encrypted or plain Standard Notes',
    instructions: 'In Standard Notes: Account → Data Backups → Download',
    color: 'from-indigo-600 to-blue-700',
  },
  {
    id: 'todoist',
    name: 'Todoist',
    icon: '✅',
    formats: ['.csv', '.json'],
    description: 'Import Todoist tasks as checklists',
    instructions: 'In Todoist: Settings → Integrations → Export as template',
    color: 'from-red-600 to-rose-700',
  },
  {
    id: 'trello',
    name: 'Trello',
    icon: '📋',
    formats: ['.json'],
    description: 'Import Trello boards and cards',
    instructions: 'In Trello: Menu → More → Print and Export → Export as JSON',
    color: 'from-blue-500 to-sky-600',
  },
  {
    id: 'markdown',
    name: 'Markdown Files',
    icon: '📄',
    formats: ['.md', '.markdown', '.txt'],
    description: 'Import any Markdown or text files',
    instructions: 'Select your .md or .txt files',
    color: 'from-gray-600 to-slate-700',
  },
  {
    id: 'html',
    name: 'HTML Files',
    icon: '🌐',
    formats: ['.html', '.htm'],
    description: 'Import HTML documents as notes',
    instructions: 'Select your .html files',
    color: 'from-orange-600 to-red-600',
  },
  {
    id: 'json',
    name: 'JSON / NTK Backup',
    icon: '💾',
    formats: ['.json'],
    description: 'Import NTK Note backups or generic JSON',
    instructions: 'Select your backup .json file',
    color: 'from-indigo-500 to-purple-600',
  },
];

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

interface ImportPreviewNote {
  id: string;
  sourceFile: string;
  notebookId: string;
  note: Partial<Note>;
}

export default function ImportManager({ onClose }: { onClose: () => void }) {
  const { createNote, notebooks, settings } = useStore();
  const [selectedSource, setSelectedSource] = useState<ImportSource | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewNotes, setPreviewNotes] = useState<ImportPreviewNote[]>([]);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [defaultNotebookId, setDefaultNotebookId] = useState(settings.defaultNotebook || notebooks[0]?.id || 'default');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const now = () => new Date().toISOString();

  useEffect(() => {
    if (!notebooks.some(notebook => notebook.id === defaultNotebookId)) {
      setDefaultNotebookId(settings.defaultNotebook || notebooks[0]?.id || 'default');
    }
  }, [defaultNotebookId, notebooks, settings.defaultNotebook]);

  const handleDefaultNotebookChange = (notebookId: string) => {
    setDefaultNotebookId(notebookId);
    setPreviewNotes(items => items.map(item => ({ ...item, notebookId })));
  };

  const handlePreviewNotebookChange = (previewId: string, notebookId: string) => {
    setPreviewNotes(items => items.map(item => item.id === previewId ? { ...item, notebookId } : item));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PARSERS FOR DIFFERENT FORMATS
  // ═══════════════════════════════════════════════════════════════════════════

  // Parse Evernote ENEX (XML format)
  const parseEvernoteENEX = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const noteElements = doc.querySelectorAll('note');

    noteElements.forEach(noteEl => {
      const title = noteEl.querySelector('title')?.textContent || 'Untitled';
      const contentEl = noteEl.querySelector('content');
      let noteContent = '';

      if (contentEl?.textContent) {
        // ENEX content is XHTML wrapped in CDATA
        const innerDoc = parser.parseFromString(contentEl.textContent, 'text/html');
        noteContent = innerDoc.body?.textContent || '';
      }

      const created = noteEl.querySelector('created')?.textContent;
      const updated = noteEl.querySelector('updated')?.textContent;

      // Extract tags
      const tagElements = noteEl.querySelectorAll('tag');
      const tags: string[] = [];
      tagElements.forEach(tag => {
        if (tag.textContent) tags.push(tag.textContent);
      });

      notes.push({
        title,
        content: noteContent.trim(),
        tags,
        type: 'note',
        createdAt: created ? parseEvernoteDate(created) : now(),
        updatedAt: updated ? parseEvernoteDate(updated) : now(),
      });
    });

    return notes;
  };

  const parseEvernoteDate = (dateStr: string): string => {
    // Evernote date format: 20231215T120000Z
    try {
      const year = dateStr.slice(0, 4);
      const month = dateStr.slice(4, 6);
      const day = dateStr.slice(6, 8);
      const hour = dateStr.slice(9, 11);
      const min = dateStr.slice(11, 13);
      const sec = dateStr.slice(13, 15);
      return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
    } catch {
      return now();
    }
  };

  // Parse Google Keep JSON (from Takeout)
  const parseGoogleKeepJSON = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];
    
    try {
      const data = JSON.parse(content);
      const items = Array.isArray(data) ? data : [data];

      items.forEach(item => {
        // Skip trashed items
        if (item.isTrashed) return;

        const title = item.title || '';
        let noteContent = item.textContent || '';
        const tags: string[] = [];
        const checklist: ChecklistItem[] = [];

        // Handle labels/tags
        if (item.labels) {
          item.labels.forEach((label: { name: string }) => {
            if (label.name) tags.push(label.name);
          });
        }

        // Handle list items (checklists)
        if (item.listContent && Array.isArray(item.listContent)) {
          item.listContent.forEach((listItem: { text: string; isChecked: boolean }, idx: number) => {
            checklist.push({
              id: uuid(),
              text: listItem.text || '',
              checked: listItem.isChecked || false,
              order: idx,
            });
          });
        }

        // Parse color
        let color: Note['color'] = 'default';
        if (item.color) {
          const colorMap: Record<string, Note['color']> = {
            'DEFAULT': 'default',
            'RED': 'red',
            'ORANGE': 'orange',
            'YELLOW': 'yellow',
            'GREEN': 'green',
            'TEAL': 'teal',
            'BLUE': 'blue',
            'PURPLE': 'purple',
            'PINK': 'pink',
            'BROWN': 'brown',
            'GRAY': 'gray',
          };
          color = colorMap[item.color] || 'default';
        }

        const createdMs = item.createdTimestampUsec ? item.createdTimestampUsec / 1000 : Date.now();
        const updatedMs = item.userEditedTimestampUsec ? item.userEditedTimestampUsec / 1000 : createdMs;

        notes.push({
          title,
          content: noteContent,
          type: checklist.length > 0 ? 'checklist' : 'note',
          checklist,
          tags,
          color,
          pinned: item.isPinned || false,
          archived: item.isArchived || false,
          createdAt: new Date(createdMs).toISOString(),
          updatedAt: new Date(updatedMs).toISOString(),
        });
      });
    } catch (e) {
      console.error('Failed to parse Google Keep JSON:', e);
    }

    return notes;
  };

  // Parse Simplenote JSON
  const parseSimplenoteJSON = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];

    try {
      const data = JSON.parse(content);
      const items = data.activeNotes || data.notes || (Array.isArray(data) ? data : []);

      items.forEach((item: any) => {
        const noteContent = item.content || item.text || '';
        // First line as title
        const lines = noteContent.split('\n');
        const title = lines[0]?.slice(0, 100) || 'Untitled';
        const content = lines.slice(1).join('\n').trim();

        const tags: string[] = [];
        if (item.tags && Array.isArray(item.tags)) {
          tags.push(...item.tags);
        }
        if (item.systemTags && Array.isArray(item.systemTags)) {
          // Simplenote system tags like 'markdown', 'pinned'
          if (item.systemTags.includes('markdown')) {
            // Mark as markdown note
          }
        }

        notes.push({
          title,
          content,
          type: item.systemTags?.includes('markdown') ? 'markdown' : 'note',
          tags,
          pinned: item.systemTags?.includes('pinned') || item.pinned || false,
          createdAt: item.creationDate ? new Date(item.creationDate * 1000).toISOString() : now(),
          updatedAt: item.modificationDate ? new Date(item.modificationDate * 1000).toISOString() : now(),
        });
      });
    } catch (e) {
      console.error('Failed to parse Simplenote JSON:', e);
    }

    return notes;
  };

  // Parse Notion Markdown/HTML export
  const parseNotionExport = (content: string, filename: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];
    
    // Extract title from filename (Notion exports with UUIDs)
    let title = filename.replace(/\.md$|\.html$/i, '');
    // Remove Notion's UUID suffix if present
    title = title.replace(/\s+[a-f0-9]{32}$/i, '');

    if (filename.endsWith('.md')) {
      // Parse Markdown
      const lines = content.split('\n');
      // First H1 as title if exists
      const h1Match = lines[0]?.match(/^#\s+(.+)/);
      if (h1Match) {
        title = h1Match[1];
        content = lines.slice(1).join('\n').trim();
      }

      // Extract tags from Notion properties if present
      const tags: string[] = [];
      const tagMatch = content.match(/Tags?:\s*(.+)/i);
      if (tagMatch) {
        tags.push(...tagMatch[1].split(',').map(t => t.trim()));
      }

      notes.push({
        title,
        content,
        type: 'markdown',
        tags,
      });
    } else {
      // Parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      
      const h1 = doc.querySelector('h1');
      if (h1?.textContent) title = h1.textContent;

      const body = doc.body?.textContent || '';

      notes.push({
        title,
        content: body.trim(),
        type: 'note',
      });
    }

    return notes;
  };

  // Parse Roam Research JSON
  const parseRoamJSON = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];

    try {
      const data = JSON.parse(content);
      
      const processPage = (page: any) => {
        const title = page.title || 'Untitled';
        let noteContent = '';
        const tags: string[] = [];

        // Process children (blocks)
        const processChildren = (children: any[], indent = 0) => {
          if (!children) return;
          children.forEach(child => {
            const prefix = '  '.repeat(indent) + '- ';
            noteContent += prefix + (child.string || '') + '\n';
            
            // Extract [[links]] as tags
            const links = child.string?.match(/\[\[([^\]]+)\]\]/g) || [];
            links.forEach((link: string) => {
              const tag = link.slice(2, -2);
              if (!tags.includes(tag)) tags.push(tag);
            });

            if (child.children) {
              processChildren(child.children, indent + 1);
            }
          });
        };

        processChildren(page.children || []);

        notes.push({
          title,
          content: noteContent.trim(),
          type: 'markdown',
          tags,
          createdAt: page['create-time'] ? new Date(page['create-time']).toISOString() : now(),
          updatedAt: page['edit-time'] ? new Date(page['edit-time']).toISOString() : now(),
        });
      };

      if (Array.isArray(data)) {
        data.forEach(processPage);
      } else if (data.pages) {
        data.pages.forEach(processPage);
      }
    } catch (e) {
      console.error('Failed to parse Roam JSON:', e);
    }

    return notes;
  };

  // Parse Standard Notes JSON
  const parseStandardNotesJSON = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];

    try {
      const data = JSON.parse(content);
      const items = data.items || [];

      items.forEach((item: any) => {
        if (item.content_type !== 'Note') return;
        
        const noteData = item.content || {};
        notes.push({
          title: noteData.title || 'Untitled',
          content: noteData.text || '',
          type: 'note',
          createdAt: item.created_at || now(),
          updatedAt: item.updated_at || now(),
        });
      });
    } catch (e) {
      console.error('Failed to parse Standard Notes JSON:', e);
    }

    return notes;
  };

  // Parse Todoist CSV
  const parseTodoistCSV = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];
    const lines = content.split('\n');
    
    if (lines.length < 2) return notes;

    // Parse header
    const headers = parseCSVLine(lines[0]);
    const contentIdx = headers.findIndex(h => h.toLowerCase() === 'content');
    const projectIdx = headers.findIndex(h => h.toLowerCase() === 'project');

    // Group by project
    const projectTasks: Record<string, ChecklistItem[]> = {};

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (!cols[contentIdx]) continue;

      const project = cols[projectIdx] || 'Inbox';
      if (!projectTasks[project]) projectTasks[project] = [];

      projectTasks[project].push({
        id: uuid(),
        text: cols[contentIdx],
        checked: false,
        order: projectTasks[project].length,
      });
    }

    // Create a note per project
    Object.entries(projectTasks).forEach(([project, tasks]) => {
      notes.push({
        title: `Todoist: ${project}`,
        content: '',
        type: 'checklist',
        checklist: tasks,
        tags: ['todoist', project.toLowerCase()],
      });
    });

    return notes;
  };

  // Parse Trello JSON
  const parseTrelloJSON = (content: string): Partial<Note>[] => {
    const notes: Partial<Note>[] = [];

    try {
      const data = JSON.parse(content);
      
      // Process each card
      const cards = data.cards || [];
      cards.forEach((card: any) => {
        if (card.closed) return;

        const checklist: ChecklistItem[] = [];
        
        // Find checklists for this card
        const cardChecklists = (data.checklists || []).filter((cl: any) => cl.idCard === card.id);
        cardChecklists.forEach((cl: any) => {
          (cl.checkItems || []).forEach((item: any) => {
            checklist.push({
              id: uuid(),
              text: item.name || '',
              checked: item.state === 'complete',
              order: checklist.length,
            });
          });
        });

        // Find list name for tag
        const list = (data.lists || []).find((l: any) => l.id === card.idList);
        const tags = list ? [list.name] : [];
        tags.push('trello');

        notes.push({
          title: card.name || 'Untitled',
          content: card.desc || '',
          type: checklist.length > 0 ? 'checklist' : 'note',
          checklist,
          tags,
        });
      });
    } catch (e) {
      console.error('Failed to parse Trello JSON:', e);
    }

    return notes;
  };

  // Parse plain Markdown
  const parseMarkdown = (content: string, filename: string): Partial<Note>[] => {
    const lines = content.split('\n');
    let title = filename.replace(/\.md$|\.markdown$|\.txt$/i, '');
    
    // Use first H1 as title
    const h1Match = lines[0]?.match(/^#\s+(.+)/);
    if (h1Match) {
      title = h1Match[1];
    }

    // Extract YAML frontmatter tags
    const tags: string[] = [];
    if (lines[0] === '---') {
      const endIdx = lines.findIndex((l, i) => i > 0 && l === '---');
      if (endIdx > 0) {
        const frontmatter = lines.slice(1, endIdx).join('\n');
        const tagMatch = frontmatter.match(/tags?:\s*\[?([^\]\n]+)\]?/i);
        if (tagMatch) {
          tags.push(...tagMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')));
        }
        content = lines.slice(endIdx + 1).join('\n');
      }
    }

    return [{
      title,
      content: content.trim(),
      type: 'markdown',
      tags,
    }];
  };

  // Parse HTML
  const parseHTML = (content: string, filename: string): Partial<Note>[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    
    let title = filename.replace(/\.html?$/i, '');
    const titleEl = doc.querySelector('title') || doc.querySelector('h1');
    if (titleEl?.textContent) title = titleEl.textContent;

    // Get text content
    const body = doc.body?.innerText || doc.body?.textContent || '';

    return [{
      title,
      content: body.trim(),
      type: 'note',
    }];
  };

  // CSV line parser
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  // Parse NTK backup JSON
  const parseNTKBackup = (content: string): Partial<Note>[] => {
    try {
      const data = JSON.parse(content);
      if (data.notes && Array.isArray(data.notes)) {
        return data.notes.map((n: any) => ({
          ...n,
          id: undefined, // Generate new IDs
        }));
      }
    } catch (e) {
      console.error('Failed to parse NTK backup:', e);
    }
    return [];
  };

  const parseGenericJSON = (content: string): Partial<Note>[] => {
    const ntkNotes = parseNTKBackup(content);
    if (ntkNotes.length > 0) return ntkNotes;

    const keepNotes = parseGoogleKeepJSON(content);
    if (keepNotes.length > 0) return keepNotes;

    const simplenoteNotes = parseSimplenoteJSON(content);
    if (simplenoteNotes.length > 0) return simplenoteNotes;

    return [];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  const handleFiles = async (files: FileList) => {
    if (!selectedSource) return;
    
    setImporting(true);
    setResult(null);
    const nextPreview: ImportPreviewNote[] = [];
    const errors: string[] = [];
    let failed = 0;

    for (const file of Array.from(files)) {
      try {
        const content = await file.text();
        let parsedNotes: Partial<Note>[] = [];

        // Route to appropriate parser
        const ext = file.name.toLowerCase().split('.').pop() || '';
        
        if (selectedSource.id === 'evernote' && ext === 'enex') {
          parsedNotes = parseEvernoteENEX(content);
        } else if (selectedSource.id === 'google-keep' && ext === 'json') {
          parsedNotes = parseGoogleKeepJSON(content);
        } else if (selectedSource.id === 'simplenote' && ext === 'json') {
          parsedNotes = parseSimplenoteJSON(content);
        } else if (selectedSource.id === 'roam' && ext === 'json') {
          parsedNotes = parseRoamJSON(content);
        } else if (selectedSource.id === 'standard-notes' && ext === 'json') {
          parsedNotes = parseStandardNotesJSON(content);
        } else if (selectedSource.id === 'todoist' && ext === 'csv') {
          parsedNotes = parseTodoistCSV(content);
        } else if (selectedSource.id === 'trello' && ext === 'json') {
          parsedNotes = parseTrelloJSON(content);
        } else if (selectedSource.id === 'notion') {
          parsedNotes = parseNotionExport(content, file.name);
        } else if (selectedSource.id === 'json') {
          parsedNotes = parseNTKBackup(content);
        } else if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
          parsedNotes = parseMarkdown(content, file.name);
        } else if (ext === 'html' || ext === 'htm') {
          parsedNotes = parseHTML(content, file.name);
        } else if (ext === 'json') {
          parsedNotes = parseGenericJSON(content);
        } else {
          errors.push(`Unsupported format: ${file.name}`);
          failed++;
          continue;
        }

        if (parsedNotes.length === 0) {
          errors.push(`No notes found in: ${file.name}`);
          failed++;
        } else {
          parsedNotes.forEach((noteData, index) => {
            nextPreview.push({
              id: `${file.name}-${index}-${uuid()}`,
              sourceFile: file.name,
              notebookId: defaultNotebookId,
              note: noteData,
            });
          });
        }
      } catch (e: any) {
        errors.push(`Error processing ${file.name}: ${e.message}`);
        failed++;
      }
    }

    setPreviewNotes(nextPreview);
    setSelectedPreviewIds(new Set(nextPreview.map(item => item.id)));
    setPreviewErrors(errors);
    if (nextPreview.length === 0 && failed > 0) {
      setResult({ success: 0, failed, errors });
    }
    setImporting(false);
  };

  const confirmImport = async () => {
    const selected = previewNotes.filter(item => selectedPreviewIds.has(item.id));
    if (selected.length === 0) return;

    setImporting(true);
    const results: ImportResult = { success: 0, failed: 0, errors: [...previewErrors] };
    for (const item of selected) {
      try {
        await createNote({
          title: item.note.title || 'Imported Note',
          content: item.note.content || '',
          type: item.note.type || 'note',
          tags: item.note.tags || [],
          color: item.note.color || 'default',
          checklist: item.note.checklist || [],
          notebookId: item.notebookId || defaultNotebookId,
          pinned: item.note.pinned || false,
          archived: item.note.archived || false,
          createdAt: item.note.createdAt,
          updatedAt: item.note.updatedAt,
        });
        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Error importing ${item.note.title || item.sourceFile}: ${error.message}`);
      }
    }
    setResult(results);
    setPreviewNotes([]);
    setSelectedPreviewIds(new Set());
    setPreviewErrors([]);
    setImporting(false);
  };

  const clearPreview = () => {
    setPreviewNotes([]);
    setSelectedPreviewIds(new Set());
    setPreviewErrors([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const togglePreviewSelection = (id: string) => {
    setSelectedPreviewIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFiles(e.target.files);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] theme-card rounded-2xl border overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b theme-divider shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-theme-primary text-lg">Import Notes</h2>
              <p className="text-xs text-theme-tertiary">Import from 15+ apps and formats</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg theme-hover text-theme-tertiary" aria-label="Close import manager">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedSource ? (
            // Source selection grid
            <div>
              <p className="text-sm text-theme-secondary mb-4">
                Select where you want to import from:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {importSources.map(source => (
                  <button
                    key={source.id}
                    onClick={() => { clearPreview(); setSelectedSource(source); }}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border theme-divider theme-hover transition-all text-center group"
                  >
                    <span className="text-2xl">{source.icon}</span>
                    <span className="text-sm font-medium text-theme-primary">{source.name}</span>
                    <span className="text-xs text-theme-tertiary">{source.formats.join(', ')}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : result ? (
            // Import results
            <div className="text-center py-8">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${result.success > 0 ? 'bg-green-100 dark:bg-green-500/20' : 'bg-red-100 dark:bg-red-500/20'}`}>
                {result.success > 0 ? (
                  <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                )}
              </div>
              <h3 className="text-xl font-bold text-theme-primary mb-2">Import Complete</h3>
              <p className="text-theme-secondary mb-4">
                {result.success} notes imported successfully
                {result.failed > 0 && `, ${result.failed} failed`}
              </p>
              {result.errors.length > 0 && (
                <div className="text-left max-w-md mx-auto mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-400">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <p key={i}>• {err}</p>
                  ))}
                  {result.errors.length > 5 && <p>...and {result.errors.length - 5} more</p>}
                </div>
              )}
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { clearPreview(); setSelectedSource(null); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium theme-muted-surface text-theme-secondary theme-hover"
                >
                  Import More
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium accent-button"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            // File upload for selected source
            <div>
              <button
                onClick={() => { clearPreview(); setSelectedSource(null); }}
                className="flex items-center gap-1 text-sm accent-text hover:underline mb-4"
              >
                ← Back to sources
              </button>

              <div className="flex items-center gap-3 mb-6">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${selectedSource.color} flex items-center justify-center text-2xl`}>
                  {selectedSource.icon}
                </div>
                <div>
                  <h3 className="font-bold text-theme-primary">{selectedSource.name}</h3>
                  <p className="text-sm text-theme-tertiary">{selectedSource.description}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl border theme-divider mb-4" style={{ backgroundColor: 'var(--input-bg)' }}>
                <label htmlFor="import-default-notebook" className="flex items-center gap-2 text-sm font-semibold text-theme-primary mb-2">
                  <BookOpen className="w-4 h-4 no-transition accent-text" />
                  Import into notebook
                </label>
                <select
                  id="import-default-notebook"
                  value={defaultNotebookId}
                  onChange={event => handleDefaultNotebookChange(event.target.value)}
                  className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                >
                  {notebooks.map(notebook => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-theme-tertiary mt-2">
                  This notebook is applied to every imported note. You can change individual notes in the preview.
                </p>
              </div>

              {/* Instructions */}
              <div className="p-4 rounded-xl mb-6" style={{ backgroundColor: 'var(--active-bg)' }}>
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 accent-text mt-0.5 shrink-0" />
                  <div className="text-sm" style={{ color: 'var(--badge-text)' }}>
                    <p className="font-medium mb-1">How to export from {selectedSource.name}:</p>
                    <p>{selectedSource.instructions}</p>
                  </div>
                </div>
              </div>

              {previewErrors.length > 0 && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-sm text-red-600 dark:text-red-400">
                  {previewErrors.slice(0, 4).map((error, index) => (
                    <p key={index}>â€¢ {error}</p>
                  ))}
                  {previewErrors.length > 4 && <p>...and {previewErrors.length - 4} more</p>}
                </div>
              )}

              {previewNotes.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-theme-primary flex items-center gap-2">
                        <Eye className="w-4 h-4 no-transition accent-text" />
                        Import preview
                      </h4>
                      <p className="text-xs text-theme-tertiary">{selectedPreviewIds.size} of {previewNotes.length} selected</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedPreviewIds(new Set(previewNotes.map(item => item.id)))}
                        className="px-3 py-2 rounded-lg text-sm theme-hover text-theme-secondary"
                        style={{ backgroundColor: 'var(--input-bg)' }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={clearPreview}
                        className="px-3 py-2 rounded-lg text-sm theme-hover text-theme-tertiary"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-xl border theme-divider divide-y theme-divider">
                    {previewNotes.map(item => {
                      const selected = selectedPreviewIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 p-3 theme-hover"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => togglePreviewSelection(item.id)}
                            aria-label={`Import ${item.note.title || 'Imported Note'}`}
                            className="mt-1 accent-range"
                          />
                          <FileText className="w-4 h-4 mt-1 shrink-0 text-theme-tertiary no-transition" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                              <p className="text-sm font-semibold text-theme-primary truncate">{item.note.title || 'Imported Note'}</p>
                              <span className="text-[11px] text-theme-muted truncate">{item.sourceFile}</span>
                            </div>
                            <p className="text-xs text-theme-tertiary mt-1 line-clamp-2">
                              {(item.note.content || `${item.note.checklist?.length || 0} checklist items`).replace(/<[^>]*>/g, '').slice(0, 180)}
                            </p>
                            {item.note.tags && item.note.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {item.note.tags.slice(0, 4).map(tag => (
                                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}>
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-3">
                              <label htmlFor={`preview-notebook-${item.id}`} className="block text-[11px] font-medium text-theme-tertiary mb-1">
                                Notebook
                              </label>
                              <select
                                id={`preview-notebook-${item.id}`}
                                value={item.notebookId}
                                onChange={event => handlePreviewNotebookChange(item.id, event.target.value)}
                                onClick={event => event.stopPropagation()}
                                className="w-full sm:w-56 px-2.5 py-1.5 rounded-lg theme-input accent-focus border text-xs focus:outline-none"
                              >
                                {notebooks.map(notebook => (
                                  <option key={notebook.id} value={notebook.id}>
                                    {notebook.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 justify-end">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 rounded-lg text-sm font-medium theme-hover text-theme-secondary"
                      style={{ backgroundColor: 'var(--input-bg)' }}
                    >
                      Add More Files
                    </button>
                    <button
                      onClick={() => void confirmImport()}
                      disabled={importing || selectedPreviewIds.size === 0}
                      className="px-4 py-2 rounded-lg text-sm font-medium accent-button disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing ? 'Importing...' : `Import ${selectedPreviewIds.size} Selected`}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'accent-border'
                      : 'border-surface-300 dark:border-surface-600 theme-hover'
                  }`}
                >
                  {importing ? (
                    <div className="flex flex-col items-center">
                      <Loader2 className="w-10 h-10 accent-text animate-spin mb-3" />
                      <p className="text-theme-secondary">Preparing preview...</p>
                    </div>
                  ) : (
                    <>
                      <FolderOpen className="w-10 h-10 text-theme-tertiary mx-auto mb-3" />
                      <p className="text-theme-secondary font-medium mb-1">
                        Drop your files here or click to browse
                      </p>
                      <p className="text-sm text-theme-tertiary">
                        Supported: {selectedSource.formats.join(', ')}
                      </p>
                    </>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={selectedSource.formats.join(',')}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
