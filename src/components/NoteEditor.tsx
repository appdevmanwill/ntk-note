import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/store';
import type { ChecklistItem, NoteColor, Priority } from '@/types';
import { noteColors, priorityConfig } from '@/utils/colors';
import { exportToPDF, copyAsPlainText, copyAsMarkdown, copyAsHTML, shareViaEmail, printNote } from '@/utils/export';
import { getBacklinks, noteDisplayTitle } from '@/utils/links';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuid } from 'uuid';
import {
  ArrowLeft, Bold, Italic, Underline, Strikethrough, List,
  ListOrdered, Heading1, Heading2, Heading3, Quote, Code,
  Minus, Link, Pin, Star, MoreHorizontal, Palette,
  Tag, Bell, CheckSquare, Trash2, Archive, Copy,
  Download, Share2, Mail, FileText, Type, Hash,
  X, Plus, Clock, AlertCircle, Eye, Edit3,
  Maximize2, Minimize2, Sparkles, PanelRightClose,
  Lock, Unlock, ShieldCheck, Link2, Mic, PenTool, FileCode, FilePlus
} from 'lucide-react';
import { format } from 'date-fns';
import { noteThemes } from '@/utils/noteThemes';
import SketchModal from './SketchModal';
import ShareModal from './ShareModal';

const isMarkdown = (text: string): boolean => {
  if (!text) return false;
  const headingPattern = /^#+\s+.+/m;
  const boldPattern = /\*\*([^*]+)\*\*/;
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
  const codeBlockPattern = /```[\s\S]*?```/;
  return (
    headingPattern.test(text) ||
    boldPattern.test(text) ||
    linkPattern.test(text) ||
    codeBlockPattern.test(text)
  );
};

const convertMarkdownToPlainText = (md: string): string => {
  let text = md;

  // Convert headers: e.g. # Header -> HEADER, ## Subheader -> SUBHEADER
  text = text.replace(/^#\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}\n${'='.repeat(Math.max(p1.length, 10))}`;
  });
  text = text.replace(/^##\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}\n${'-'.repeat(Math.max(p1.length, 10))}`;
  });
  text = text.replace(/^###\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}`;
  });
  text = text.replace(/^####+\s+(.+)$/gm, (_, p1) => {
    return `${p1}`;
  });

  // Convert Bold / Italic / Bold+Italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/___([^_]+)___/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // Convert Strikethrough
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Convert Inline Code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Convert Links: [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Convert Images: ![alt](url) -> [Image: alt]
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[Image: $1]');

  // Convert Lists: bullets - / * -> •
  text = text.replace(/^[-*]\s+(.+)$/gm, '• $1');

  // Convert Blockquotes: remove > prefix
  text = text.replace(/^>\s+(.+)$/gm, '  $1');

  // Strip table delimiters
  text = text.replace(/^[|]/gm, '');
  text = text.replace(/[|]$/gm, '');
  text = text.replace(/[|]/g, '  ');
  text = text.replace(/^\s*[:-|-]+\s*$/gm, '');

  return text;
};

const convertMarkdownToHTML = (md: string): string => {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headings
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^####+\s+(.+)$/gm, '<h4>$1</h4>');

  // Bold / Italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Code Blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline Code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // Lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs
  html = html.replace(/^(?!<(h\d|li|pre|code|del|a|img|ul|ol))(.+)$/gm, '<p>$2</p>');

  return html;
};

export default function NoteEditor({ onCollapsePanel }: { onCollapsePanel?: () => void }) {
  const {
    selectedNoteId, notes, updateNote, selectNote, trashNote,
    archiveNote, pinNote, starNote, duplicateNote,
    setNoteColor, setNotePriority, addNoteTag, removeNoteTag,
    addChecklistItem, updateChecklistItem, removeChecklistItem,
    setNoteReminder, settings, toggleZenMode, notebooks, moveNote,
    setEditingNote, setNoteTheme,
    lockNote, unlockNote, relockNote, updateUnlockedNote, unlockedNotes,
    templates,
  } = useStore();

  const note = notes.find(n => n.id === selectedNoteId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showToolbar] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [showPriority, setShowPriority] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [lockHint, setLockHint] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockBusy, setLockBusy] = useState(false);

  const SpeechRecognition = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const isSpeechSupported = !!SpeechRecognition;

  const [isListening, setIsListening] = useState(false);
  const [showSketchModal, setShowSketchModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showTemplatesDropdown, setShowTemplatesDropdown] = useState(false);
  const [activeFormat, setActiveFormat] = useState<'rich' | 'plain' | 'code' | 'html'>('plain');
  const recognitionRef = useRef<any>(null);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const appendDictationText = useCallback((textToAppend: string) => {
    const el = contentRef.current;
    const spacing = textToAppend.startsWith(' ') ? '' : ' ';
    const formattedText = spacing + textToAppend.trim();
    
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + formattedText + content.slice(end);
      setContent(newContent);
      saveNote(title, newContent);
      const newCursorPos = start + formattedText.length;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else {
      const newContent = content ? content + formattedText : textToAppend.trim();
      setContent(newContent);
      saveNote(title, newContent);
    }
  }, [content, title, saveNote]);

  const toggleListening = () => {
    if (!isSpeechSupported) return;
    
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
    } else {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      
      rec.onstart = () => {
        setIsListening(true);
      };
      
      rec.onresult = (event: any) => {
        const transcript = event.results[event.resultIndex][0].transcript;
        if (transcript) {
          appendDictationText(transcript);
        }
      };
      
      rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };
      
      rec.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = rec;
      rec.start();
    }
  };

  const handleInsertDrawing = (dataUrl: string) => {
    const el = contentRef.current;
    const imgMarkdown = `\n![Sketch](${dataUrl})\n`;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + imgMarkdown + content.slice(end);
      setContent(newContent);
      saveNote(title, newContent);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + imgMarkdown.length, start + imgMarkdown.length);
      }, 0);
    } else {
      const newContent = content ? content + imgMarkdown : imgMarkdown;
      setContent(newContent);
      saveNote(title, newContent);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!note || note.type !== 'note') return; // only for regular notes

    const pastedData = e.clipboardData.getData('text/plain');
    if (isMarkdown(pastedData)) {
      e.preventDefault();
      const converted = convertMarkdownToPlainText(pastedData);
      
      // Insert at selection
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + converted + content.slice(end);
      setContent(newContent);
      saveNote(title, newContent);
      
      const newCursorPos = start + converted.length;
      setTimeout(() => {
        el.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unlockedNote = note ? unlockedNotes[note.id] : undefined;
  const isLocked = !!note?.encrypted && !unlockedNote;
  const activeChecklist = note?.encrypted && unlockedNote ? unlockedNote.checklist : note?.checklist || [];

  // Load note data
  useEffect(() => {
    if (note) {
      setTitle(unlockedNote?.title ?? note.title);
      setContent(unlockedNote?.content ?? note.content);
      setIsPreview(false);
      if (note.type === 'markdown') {
        setActiveFormat('rich');
      } else {
        setActiveFormat('plain');
      }
    }
  }, [note?.id, unlockedNote?.title, unlockedNote?.content]);

  // Auto-save
  const saveNote = useCallback((t: string, c: string, immediate = false) => {
    if (!note) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!settings.autoSave && !immediate) return;
    if (immediate) {
      if (note.encrypted && unlockedNote) {
        updateUnlockedNote(note.id, { title: t, content: c });
      } else {
        updateNote(note.id, { title: t, content: c });
      }
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      if (note.encrypted && unlockedNote) {
        updateUnlockedNote(note.id, { title: t, content: c });
      } else {
        updateNote(note.id, { title: t, content: c });
      }
    }, 300);
  }, [note?.id, note?.encrypted, unlockedNote, updateNote, updateUnlockedNote, settings.autoSave]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    saveNote(val, content);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    saveNote(title, val);
  };

  // Toolbar actions for rich text in textarea
  const insertFormatting = (before: string, after: string = '') => {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    let wrapStart = start;
    let wrapEnd = end;
    let selected = content.slice(start, end);

    if (!selected && after) {
      const beforeCursor = content.slice(0, start);
      const afterCursor = content.slice(start);
      wrapStart = beforeCursor.search(/\S+$/);
      if (wrapStart === -1) wrapStart = start;
      const nextSpace = afterCursor.search(/\s/);
      wrapEnd = nextSpace === -1 ? content.length : start + nextSpace;
      selected = content.slice(wrapStart, wrapEnd);
    }

    const newContent = content.slice(0, wrapStart) + before + selected + after + content.slice(wrapEnd);
    setContent(newContent);
    saveNote(title, newContent);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(wrapStart + before.length, wrapStart + before.length + selected.length);
    }, 0);
  };

  const insertAtLineStart = (prefix: string) => {
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(newContent);
    saveNote(title, newContent);
  };

  const handleAddTag = () => {
    if (tagInput.trim() && note) {
      addNoteTag(note.id, tagInput.trim());
      setTagInput('');
    }
  };

  const handleSetReminder = () => {
    if (note && reminderDate && reminderTime) {
      const time = new Date(`${reminderDate}T${reminderTime}`).toISOString();
      setNoteReminder(note.id, {
        id: uuid(),
        noteId: note.id,
        time,
        title: note.title || 'Reminder',
        triggered: false,
      });
      setShowReminder(false);
      setReminderDate('');
      setReminderTime('');
    }
  };

  const handleAddChecklistItem = () => {
    if (note && newChecklistItem.trim()) {
      if (note.encrypted && unlockedNote) {
        const item: ChecklistItem = {
          id: uuid(),
          text: newChecklistItem.trim(),
          checked: false,
          order: unlockedNote.checklist.length,
        };
        updateUnlockedNote(note.id, { checklist: [...unlockedNote.checklist, item] });
      } else {
        addChecklistItem(note.id, newChecklistItem.trim());
      }
      setNewChecklistItem('');
    }
  };

  const handleChecklistUpdate = (itemId: string, updates: Partial<ChecklistItem>) => {
    if (!note) return;
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, {
        checklist: unlockedNote.checklist.map(item => item.id === itemId ? { ...item, ...updates } : item),
      });
      return;
    }
    updateChecklistItem(note.id, itemId, updates);
  };

  const handleChecklistRemove = (itemId: string) => {
    if (!note) return;
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, {
        checklist: unlockedNote.checklist.filter(item => item.id !== itemId),
      });
      return;
    }
    removeChecklistItem(note.id, itemId);
  };

  const handleChecklistReorder = (targetItemId: string, draggedItemId: string) => {
    if (!note || draggedItemId === targetItemId) return;
    const items = [...activeChecklist].sort((a, b) => a.order - b.order);
    const draggedIdx = items.findIndex(item => item.id === draggedItemId);
    if (draggedIdx < 0) return;
    const [draggedItem] = items.splice(draggedIdx, 1);
    const targetIdx = items.findIndex(item => item.id === targetItemId);
    if (targetIdx < 0) return;
    items.splice(targetIdx, 0, draggedItem);
    const reordered = items.map((item, order) => ({ ...item, order }));
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, { checklist: reordered });
      return;
    }
    useStore.getState().reorderChecklist(note.id, reordered.map(item => item.id));
  };

  const handleLockNote = async () => {
    if (!note || !lockPassword.trim()) return;
    setLockBusy(true);
    setLockError('');
    const ok = await lockNote(note.id, lockPassword, lockHint);
    setLockBusy(false);
    if (!ok) {
      setLockError('Enter a password to lock this note.');
      return;
    }
    setShowLockDialog(false);
    setLockPassword('');
    setLockHint('');
    setShowMenu(false);
  };

  const handleUnlockNote = async () => {
    if (!note || !unlockPassword.trim()) return;
    setLockBusy(true);
    setLockError('');
    const ok = await unlockNote(note.id, unlockPassword);
    setLockBusy(false);
    if (!ok) {
      setLockError('That password did not unlock this note.');
      return;
    }
    setUnlockPassword('');
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowColorPicker(false);
        setShowThemePicker(false);
        setShowPriority(false);
        setShowMoveMenu(false);
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!note) return;
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') { e.preventDefault(); insertFormatting('**', '**'); }
        if (key === 'i') { e.preventDefault(); insertFormatting('*', '*'); }
        if (key === 'u') { e.preventDefault(); insertFormatting('<u>', '</u>'); }
        if (key === 'k') { e.preventDefault(); insertFormatting('[', '](url)'); }
        if (key === 's') { e.preventDefault(); saveNote(title, content, true); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [note, content, title, saveNote]);

  const insertTemplate = (templateContent: string) => {
    insertFormatting(templateContent);
    setShowTemplatesDropdown(false);
  };

  if (!note) {
    return (
      <div className="relative flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--app-bg)' }}>
        {onCollapsePanel && (
          <button
            type="button"
            onClick={onCollapsePanel}
            className="hidden lg:inline-flex absolute right-4 top-4 p-2 rounded-xl theme-hover text-theme-tertiary"
            title="Collapse editor panel"
            aria-label="Collapse editor panel"
          >
            <PanelRightClose className="w-5 h-5 no-transition" />
          </button>
        )}
        <div className="text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 no-transition" style={{ color: 'var(--text-muted)' }} />
          <h3 className="text-lg font-medium text-theme-secondary">Select a note to edit</h3>
          <p className="text-sm text-theme-tertiary mt-1">Or create a new one to get started</p>
        </div>
      </div>
    );
  }

  const notebook = notebooks.find(nb => nb.id === note.notebookId);
  const activeNoteTheme = note.theme || settings.defaultNoteTheme || 'canvas';
  const backlinks = getBacklinks(note.id, notes);

  const toolbarButtons = [
    { icon: Bold, action: () => insertFormatting('**', '**'), title: 'Bold (Ctrl+B)' },
    { icon: Italic, action: () => insertFormatting('*', '*'), title: 'Italic (Ctrl+I)' },
    { icon: Underline, action: () => insertFormatting('<u>', '</u>'), title: 'Underline (Ctrl+U)' },
    { icon: Strikethrough, action: () => insertFormatting('~~', '~~'), title: 'Strikethrough' },
    null, // separator
    { icon: Heading1, action: () => insertAtLineStart('# '), title: 'Heading 1' },
    { icon: Heading2, action: () => insertAtLineStart('## '), title: 'Heading 2' },
    { icon: Heading3, action: () => insertAtLineStart('### '), title: 'Heading 3' },
    null,
    { icon: List, action: () => insertAtLineStart('- '), title: 'Bullet list' },
    { icon: ListOrdered, action: () => insertAtLineStart('1. '), title: 'Numbered list' },
    { icon: CheckSquare, action: () => insertAtLineStart('- [ ] '), title: 'Task list' },
    null,
    { icon: Quote, action: () => insertAtLineStart('> '), title: 'Blockquote' },
    { icon: Code, action: () => insertFormatting('`', '`'), title: 'Inline code' },
    { icon: Minus, action: () => insertFormatting('\n---\n'), title: 'Horizontal rule' },
    { icon: Link, action: () => insertFormatting('[', '](url)'), title: 'Link (Ctrl+K)' },
    null,
    { icon: Type, action: () => {
      const url = prompt('Enter image URL:');
      if (url) insertFormatting(`![Image](${url})`);
    }, title: 'Insert image URL' },
    { icon: Hash, action: () => {
      const table = `\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n`;
      insertFormatting(table);
    }, title: 'Insert table' },
  ];

  return (
    <div
      className={`note-theme-editor flex-1 flex flex-col h-full ${settings.zenMode ? 'zen-mode' : ''}`}
      data-note-theme={activeNoteTheme}
      style={{ backgroundColor: 'var(--note-theme-bg, var(--editor-bg))' }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b theme-divider shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { selectNote(null); setEditingNote(false); }}
            className="p-1.5 rounded-lg theme-hover lg:hidden" style={{ color: 'var(--text-tertiary)' }}
            aria-label="Close editor"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {onCollapsePanel && (
            <button
              type="button"
              onClick={onCollapsePanel}
              className="hidden lg:inline-flex p-1.5 rounded-lg theme-hover text-theme-tertiary"
              title="Collapse editor panel"
              aria-label="Collapse editor panel"
            >
              <PanelRightClose className="w-5 h-5 no-transition" />
            </button>
          )}
          
          {notebook && (
            <span className="text-xs text-theme-tertiary flex items-center gap-1">
              {notebook.icon} {notebook.name}
            </span>
          )}
          
          <span className="text-xs text-theme-tertiary">
            <Clock className="w-3 h-3 inline mr-1" />
            {format(new Date(note.updatedAt), 'MMM d, h:mm a')}
          </span>
        </div>

        <div className="flex items-center gap-1" ref={menuRef}>
          {/* Preview toggle for markdown */}
          {note.type === 'markdown' && (
            <button
              onClick={() => setIsPreview(!isPreview)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: isPreview ? 'var(--active-bg)' : 'transparent', color: isPreview ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
              title={isPreview ? 'Edit' : 'Preview'}
              aria-label={isPreview ? 'Edit markdown' : 'Preview markdown'}
            >
              {isPreview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}

          <button
            onClick={() => pinNote(note.id)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: note.pinned ? 'var(--active-bg)' : 'transparent', color: note.pinned ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={() => starNote(note.id)}
            className="p-1.5 rounded-lg transition-colors theme-hover"
            style={{ color: note.starred ? '#f59e0b' : 'var(--text-tertiary)' }}
            aria-label={note.starred ? 'Unstar note' : 'Star note'}
          >
            <Star className={`w-4 h-4 ${note.starred ? 'fill-amber-500' : ''}`} />
          </button>

          {/* Zen mode */}
          <button
            onClick={toggleZenMode}
            className="p-1.5 rounded-lg theme-hover" style={{ color: 'var(--text-tertiary)' }}
            title="Zen mode"
            aria-label="Zen mode"
          >
            {settings.zenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* More menu */}
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 rounded-lg theme-hover" style={{ color: 'var(--text-tertiary)' }}
            aria-label="More note actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-4 top-12 z-40 w-56 rounded-xl py-1.5 animate-scale-in theme-menu border">
              <MenuBtn icon={Palette} label="Note color" onClick={() => { setShowColorPicker(!showColorPicker); }} />
              <MenuBtn icon={Sparkles} label="Note theme" onClick={() => { setShowThemePicker(!showThemePicker); }} />
              <MenuBtn icon={AlertCircle} label="Priority" onClick={() => { setShowPriority(!showPriority); }} />
              <MenuBtn icon={Tag} label="Add tag" onClick={() => { setShowTagInput(!showTagInput); setShowMenu(false); }} />
              <MenuBtn icon={Bell} label={note.reminder ? 'Update reminder' : 'Set reminder'} onClick={() => { setShowReminder(!showReminder); setShowMenu(false); }} />
              <MenuBtn icon={Hash} label="Move to notebook" onClick={() => setShowMoveMenu(!showMoveMenu)} />
              {note.encrypted && unlockedNote ? (
                <MenuBtn icon={Lock} label="Lock now" onClick={() => { relockNote(note.id); setShowMenu(false); }} />
              ) : (
                <MenuBtn icon={ShieldCheck} label={note.encrypted ? 'Unlock note' : 'Encrypt / lock note'} onClick={() => { setShowLockDialog(true); setShowMenu(false); }} />
              )}
              <div className="my-1 border-t theme-divider" />
              <MenuBtn icon={Copy} label="Duplicate" onClick={() => { duplicateNote(note.id); setShowMenu(false); }} />
              <MenuBtn icon={Share2} label="Share / Publish" onClick={() => { setShowShareModal(true); setShowMenu(false); }} />
              <MenuBtn icon={Share2} label="Export / Share" onClick={() => setShowExportMenu(!showExportMenu)} />
              <MenuBtn icon={Archive} label={note.archived ? 'Unarchive' : 'Archive'} onClick={() => { archiveNote(note.id); setShowMenu(false); }} />
              <div className="my-1 border-t theme-divider" />
              <MenuBtn icon={Trash2} label="Move to trash" onClick={() => { trashNote(note.id); setShowMenu(false); }} danger />
              
              {/* Color picker submenu */}
              {showColorPicker && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Note color</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {(Object.keys(noteColors) as NoteColor[]).map(c => (
                      <button
                        key={c}
                        onClick={() => { setNoteColor(note.id, c); setShowColorPicker(false); setShowMenu(false); }}
                        className={`w-6 h-6 rounded-full ${noteColors[c].dot} ${note.color === c ? 'ring-2 ring-offset-2' : ''} hover:scale-110 transition-transform`}
                        style={note.color === c ? { '--tw-ring-offset-color': 'var(--card-bg)', '--tw-ring-color': 'var(--accent-primary)' } as React.CSSProperties : undefined}
                        title={noteColors[c].label}
                        aria-label={`Set note color to ${noteColors[c].label}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Theme picker submenu */}
              {showThemePicker && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Premium note theme</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(noteThemes) as [keyof typeof noteThemes, typeof noteThemes.canvas][]).map(([key, theme]) => (
                      <button
                        key={key}
                        onClick={() => { setNoteTheme(note.id, key); setShowThemePicker(false); setShowMenu(false); }}
                        className="text-left rounded-lg border p-2 theme-hover"
                        aria-label={`Apply note theme ${theme.label}`}
                        style={{
                          borderColor: activeNoteTheme === key ? 'var(--accent-primary)' : 'var(--card-border)',
                          backgroundColor: activeNoteTheme === key ? 'var(--active-bg)' : 'transparent',
                        }}
                      >
                        <span className="block h-7 rounded-md mb-1.5" style={{ background: theme.preview }} />
                        <span className="block text-xs font-semibold text-theme-primary">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Priority submenu */}
              {showPriority && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Priority</p>
                  <div className="space-y-1">
                    {(Object.entries(priorityConfig) as [Priority, typeof priorityConfig.urgent][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => { setNotePriority(note.id, note.priority === key ? null : key); setShowPriority(false); setShowMenu(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${note.priority === key ? cfg.bg : 'theme-hover'} ${cfg.color}`}
                      >
                        <span>{cfg.icon}</span> {cfg.label}
                      </button>
                    ))}
                    {note.priority && (
                      <button
                        onClick={() => { setNotePriority(note.id, null); setShowPriority(false); setShowMenu(false); }}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-theme-tertiary theme-hover"
                      >
                        Clear priority
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Move to notebook */}
              {showMoveMenu && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Move to notebook</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {notebooks.map(nb => (
                      <button
                        key={nb.id}
                        onClick={() => { moveNote(note.id, nb.id); setShowMoveMenu(false); setShowMenu(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${note.notebookId === nb.id ? 'theme-active theme-accent' : 'text-theme-secondary theme-hover'}`}
                      >
                        <span>{nb.icon}</span> {nb.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Export submenu */}
              {showExportMenu && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Export & Share</p>
                  <div className="space-y-1">
                    <ExportBtn icon={Download} label="Export as PDF" onClick={() => { exportToPDF(note); setShowMenu(false); }} />
                    <ExportBtn icon={FileText} label="Copy as plain text" onClick={() => { copyAsPlainText(note); setShowMenu(false); }} />
                    <ExportBtn icon={Code} label="Copy as Markdown" onClick={() => { copyAsMarkdown(note); setShowMenu(false); }} />
                    <ExportBtn icon={Type} label="Copy as HTML" onClick={() => { copyAsHTML(note); setShowMenu(false); }} />
                    <ExportBtn icon={Mail} label="Share via email" onClick={() => { shareViaEmail(note); setShowMenu(false); }} />
                    <ExportBtn icon={FileText} label="Print note" onClick={() => { printNote(note); setShowMenu(false); }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Format Switcher */}
      {!isLocked && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-[var(--app-bg-subtle)]/30 border-b theme-divider shrink-0">
          <div className="flex items-center gap-1 bg-[var(--card-bg)] border theme-border rounded-lg p-0.5 shadow-sm">
            <button
              onClick={() => setActiveFormat('plain')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeFormat === 'plain'
                  ? 'accent-soft text-[var(--accent-primary)]'
                  : 'text-theme-secondary hover:text-theme-primary'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              Standard Text
            </button>
            <button
              onClick={() => setActiveFormat('rich')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeFormat === 'rich'
                  ? 'accent-soft text-[var(--accent-primary)]'
                  : 'text-theme-secondary hover:text-theme-primary'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Reader (Rich)
            </button>
            <button
              onClick={() => setActiveFormat('code')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeFormat === 'code'
                  ? 'accent-soft text-[var(--accent-primary)]'
                  : 'text-theme-secondary hover:text-theme-primary'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              Raw Source
            </button>
            <button
              onClick={() => setActiveFormat('html')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeFormat === 'html'
                  ? 'accent-soft text-[var(--accent-primary)]'
                  : 'text-theme-secondary hover:text-theme-primary'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              HTML Code
            </button>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-theme-tertiary">
            View Format
          </span>
        </div>
      )}

      {/* Tag input */}
      {showTagInput && (
        <div className="flex items-center gap-2 px-4 py-2 border-b theme-divider theme-bg-subtle animate-fade-in">
          <Tag className="w-4 h-4 text-theme-tertiary" />
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddTag(); if (e.key === 'Escape') setShowTagInput(false); }}
            placeholder="Add a tag..."
            className="flex-1 bg-transparent text-sm text-theme-primary focus:outline-none"
            autoFocus
          />
          <button onClick={handleAddTag} className="text-xs accent-text font-medium">Add</button>
          <button onClick={() => setShowTagInput(false)} className="text-theme-tertiary"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Reminder input */}
      {showReminder && (
        <div className="flex items-center gap-2 px-4 py-2 border-b theme-divider animate-fade-in" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
          <Bell className="w-4 h-4 text-orange-500" />
          <input type="date" value={reminderDate} onChange={e => setReminderDate(e.target.value)} className="bg-transparent text-sm text-theme-primary focus:outline-none" />
          <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} className="bg-transparent text-sm text-theme-primary focus:outline-none" />
          <button onClick={handleSetReminder} className="text-xs text-orange-600 font-medium">Set</button>
          {note.reminder && (
            <button onClick={() => { setNoteReminder(note.id, undefined); setShowReminder(false); }} className="text-xs text-red-500">Remove</button>
          )}
          <button onClick={() => setShowReminder(false)} className="text-theme-tertiary ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tags display */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b theme-divider">
          {note.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}>
              <Tag className="w-3 h-3" />{tag}
              <button onClick={() => removeNoteTag(note.id, tag)} className="hover:text-red-500 ml-0.5"><X className="w-3 h-3" /></button>
            </span>
          ))}
          <button
            onClick={() => setShowTagInput(true)}
            className="text-xs text-theme-tertiary flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      )}

      {/* Reminder display */}
      {note.reminder && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b theme-divider" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
          <Bell className="w-3.5 h-3.5 text-orange-500" />
          <span className="text-xs text-orange-600 dark:text-orange-400">
            Reminder: {format(new Date(note.reminder.time), 'MMM d, yyyy h:mm a')}
          </span>
        </div>
      )}

      {(showLockDialog || isLocked) && (
        <div className="px-4 py-3 border-b theme-divider" style={{ backgroundColor: 'var(--input-bg)' }}>
          <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-9 h-9 rounded-lg accent-soft flex items-center justify-center shrink-0">
                {isLocked ? <Lock className="w-4 h-4 no-transition" /> : <ShieldCheck className="w-4 h-4 no-transition" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-theme-primary">{isLocked ? 'Locked note' : 'Encrypt this note'}</p>
                <p className="text-xs text-theme-tertiary">
                  {isLocked ? (note.lockHint ? `Hint: ${note.lockHint}` : 'Enter the password to edit this note.') : 'Content and checklist items stay encrypted at rest.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 md:min-w-[360px]">
              {isLocked ? (
                <>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={event => setUnlockPassword(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void handleUnlockNote(); }}
                    placeholder="Password"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <button
                    onClick={() => void handleUnlockNote()}
                    disabled={lockBusy || !unlockPassword.trim()}
                    className="px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <Unlock className="w-4 h-4 no-transition" />
                    Unlock
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    value={lockPassword}
                    onChange={event => setLockPassword(event.target.value)}
                    placeholder="Password"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <input
                    type="text"
                    value={lockHint}
                    onChange={event => setLockHint(event.target.value)}
                    placeholder="Hint"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <button
                    onClick={() => void handleLockNote()}
                    disabled={lockBusy || !lockPassword.trim()}
                    className="px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4 no-transition" />
                    Lock
                  </button>
                </>
              )}
              {!isLocked && (
                <button
                  onClick={() => { setShowLockDialog(false); setLockPassword(''); setLockHint(''); setLockError(''); }}
                  className="px-3 py-2 rounded-lg theme-hover text-sm font-medium text-theme-tertiary"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          {lockError && <p className="max-w-3xl mx-auto mt-2 text-xs text-red-500">{lockError}</p>}
        </div>
      )}

      {/* Formatting Toolbar */}
      {showToolbar && !isPreview && !isLocked && note.type !== 'checklist' && (
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b theme-divider overflow-x-auto shrink-0">
          {toolbarButtons.map((btn, i) => {
            if (!btn) return <div key={i} className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--divider)' }} />;
            return (
              <button
                key={i}
                onClick={btn.action}
                title={btn.title}
                className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
              >
                <btn.icon className="w-4 h-4" />
              </button>
            );
          })}

          <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--divider)' }} />

          {/* Voice Dictation */}
          {isSpeechSupported ? (
            <button
              onClick={toggleListening}
              title={isListening ? 'Stop Voice Dictation' : 'Start Voice Dictation'}
              className={`p-1.5 rounded-md transition-colors shrink-0 relative ${
                isListening 
                  ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                  : 'theme-hover text-theme-tertiary'
              }`}
            >
              <Mic className={`w-4 h-4 ${isListening ? 'animate-pulse' : ''}`} />
              {isListening && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
              )}
            </button>
          ) : (
            <button
              disabled
              title="Voice dictation unsupported in this browser"
              className="p-1.5 rounded-md opacity-40 text-theme-tertiary shrink-0 cursor-not-allowed"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {/* Sketchpad Whiteboard */}
          <button
            onClick={() => setShowSketchModal(true)}
            title="Open Sketchpad Whiteboard"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <PenTool className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowTemplatesDropdown(!showTemplatesDropdown)}
              title="Insert Template"
              className={`p-1.5 rounded-md transition-colors shrink-0 ${showTemplatesDropdown ? 'bg-indigo-500/10 text-indigo-500' : 'theme-hover text-theme-tertiary'}`}
            >
              <FilePlus className="w-4 h-4" />
            </button>
            {showTemplatesDropdown && (
              <div 
                className="absolute left-0 top-full mt-1 w-64 rounded-xl shadow-xl border theme-card z-50 py-2 max-h-64 overflow-y-auto"
                style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
              >
                <div className="px-3 pb-2 mb-2 border-b theme-divider">
                  <span className="text-xs font-semibold text-theme-secondary uppercase tracking-wider">Insert Template</span>
                </div>
                {templates.filter(tpl => tpl.type === 'note' && tpl.content).map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => insertTemplate(tpl.content)}
                    className="w-full text-left px-4 py-2 hover:bg-indigo-500/10 transition-colors flex items-center gap-3"
                  >
                    <span className="text-lg">{tpl.icon}</span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-theme-primary">{tpl.name}</span>
                      <span className="text-xs text-theme-tertiary truncate max-w-[160px]">{tpl.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-8 py-4">
          {isLocked ? (
            <div className="min-h-[45vh] flex items-center justify-center text-center">
              <div>
                <Lock className="w-14 h-14 mx-auto mb-4 text-theme-muted no-transition" />
                <h3 className="text-lg font-semibold text-theme-primary">{noteDisplayTitle(note)}</h3>
                <p className="text-sm text-theme-tertiary mt-1">This note is encrypted and locked.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                onBlur={() => saveNote(title, content, true)}
                placeholder="Untitled"
                className="w-full text-2xl md:text-3xl font-bold bg-transparent focus:outline-none mb-4"
                spellCheck={settings.spellCheck}
                style={{
                  color: 'var(--text-primary)',
                  fontSize: `${Math.max(settings.editorFontSize + 8, 24)}px`,
                  fontFamily: settings.editorFontFamily,
                }}

              />

              {/* Content area based on type */}
              {note.type === 'checklist' && activeFormat === 'plain' ? (
                <div className="space-y-1">
                  {[...activeChecklist].sort((a, b) => a.order - b.order).map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('checklistItemId', item.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = 'var(--active-bg)';
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = '';
                        const draggedId = e.dataTransfer.getData('checklistItemId');
                        handleChecklistReorder(item.id, draggedId);
                      }}
                      className="flex items-start gap-3 group py-1 rounded-lg transition-colors cursor-move"
                    >
                      <div className="flex items-center gap-1 cursor-move opacity-0 group-hover:opacity-50">
                        <svg className="w-3 h-3 text-theme-tertiary" viewBox="0 0 6 10" fill="currentColor">
                          <circle cx="1" cy="1" r="1"/><circle cx="5" cy="1" r="1"/>
                          <circle cx="1" cy="5" r="1"/><circle cx="5" cy="5" r="1"/>
                          <circle cx="1" cy="9" r="1"/><circle cx="5" cy="9" r="1"/>
                        </svg>
                      </div>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={e => handleChecklistUpdate(item.id, { checked: e.target.checked })}
                        className="mt-0.5 accent-range w-[18px] h-[18px] cursor-pointer"
                      />
                      <input
                        type="text"
                        value={item.text}
                        onChange={e => handleChecklistUpdate(item.id, { text: e.target.value })}
                        className={`flex-1 bg-transparent text-sm focus:outline-none ${item.checked ? 'line-through text-theme-tertiary' : 'text-theme-primary'}`}
                        spellCheck={settings.spellCheck}
                        style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}
                      />
                      <button
                        onClick={() => handleChecklistRemove(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded theme-hover text-theme-tertiary transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2">
                    <Plus className="w-[18px] h-[18px] text-theme-tertiary" />
                    <input
                      type="text"
                      value={newChecklistItem}
                      onChange={e => setNewChecklistItem(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddChecklistItem(); }}
                      placeholder="Add item..."
                      className="flex-1 bg-transparent text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none"
                      spellCheck={settings.spellCheck}
                      style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}
                    />
                  </div>
                  <div className="mt-6 pt-4 border-t theme-divider">
                    <textarea
                      value={content}
                      onChange={e => handleContentChange(e.target.value)}
                      onBlur={() => saveNote(title, content, true)}
                      onPaste={handlePaste}
                      placeholder="Add notes..."
                      className="w-full min-h-[100px] bg-transparent text-theme-primary placeholder:text-theme-muted resize-none focus:outline-none"
                      spellCheck={settings.spellCheck}
                      style={{ fontSize: `${settings.editorFontSize}px`, lineHeight: '1.7', fontFamily: settings.editorFontFamily }}
                    />
                  </div>
                </div>
              ) : activeFormat === 'rich' ? (
                <div className="note-content prose dark:prose-invert max-w-none" style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*No content yet*'}</ReactMarkdown>
                </div>
              ) : activeFormat === 'code' ? (
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={e => handleContentChange(e.target.value)}
                  onBlur={() => saveNote(title, content, true)}
                  onPaste={handlePaste}
                  placeholder="Raw note source code..."
                  className="w-full min-h-[calc(100vh-300px)] bg-transparent resize-none focus:outline-none editor-area font-mono text-sm border-l-2 border-amber-500/30 pl-3 focus:border-amber-500"
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: `${settings.editorFontSize}px`,
                    lineHeight: '1.8',
                  }}
                  spellCheck={false}
                />
              ) : activeFormat === 'html' ? (
                <div className="font-mono text-xs overflow-x-auto bg-[var(--app-bg-subtle)] p-4 rounded-xl border theme-border select-all max-h-[60vh] overflow-y-auto">
                  <pre className="text-theme-secondary whitespace-pre-wrap">{convertMarkdownToHTML(content)}</pre>
                </div>
              ) : (
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={e => handleContentChange(e.target.value)}
                  onBlur={() => saveNote(title, content, true)}
                  onPaste={handlePaste}
                  placeholder={note.type === 'markdown' ? 'Write in Markdown...' : 'Start writing...'}
                  className="w-full min-h-[calc(100vh-300px)] bg-transparent resize-none focus:outline-none editor-area"
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: `${settings.editorFontSize}px`,
                    lineHeight: '1.8',
                    fontFamily: settings.editorFontFamily,
                  }}
                  spellCheck={settings.spellCheck}
                />
              )}

              {backlinks.length > 0 && (
                <div className="mt-8 pt-4 border-t theme-divider">
                  <h3 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
                    <Link2 className="w-4 h-4 no-transition accent-text" />
                    Backlinks
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {backlinks.map(backlink => (
                      <button
                        key={backlink.id}
                        onClick={() => selectNote(backlink.id)}
                        className="px-3 py-1.5 rounded-full text-sm theme-hover"
                        style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}
                      >
                        {noteDisplayTitle(backlink)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status bar */}
      {settings.showWordCount && (
        <div className="flex items-center justify-between px-4 py-1.5 border-t theme-divider text-xs text-theme-tertiary shrink-0">
          <div className="flex items-center gap-4">
            <span>{note.wordCount} words</span>
            <span>{note.charCount} characters</span>
            {note.type === 'checklist' && (
              <span>{activeChecklist.filter(c => c.checked).length}/{activeChecklist.length} tasks</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="capitalize">{note.type}</span>
            {note.priority && (
              <span className={priorityConfig[note.priority].color}>
                {priorityConfig[note.priority].icon} {priorityConfig[note.priority].label}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Sketch Modal */}
      <SketchModal
        isOpen={showSketchModal}
        onClose={() => setShowSketchModal(false)}
        onSave={handleInsertDrawing}
      />

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        entityType="note"
        entityId={note.id}
      />
    </div>
  );
}

function MenuBtn({ icon: Icon, label, onClick, danger }: {
  icon: typeof Trash2; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
        danger ? 'text-red-600 hover:bg-red-500/10' : 'theme-hover'
      }`}
      style={!danger ? { color: 'var(--text-secondary)' } : {}}
    >
      <Icon className="w-4 h-4 no-transition" /> {label}
    </button>
  );
}

function ExportBtn({ icon: Icon, label, onClick }: {
  icon: typeof Download; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm theme-hover transition-colors"
      style={{ color: 'var(--text-secondary)' }}
    >
      <Icon className="w-3.5 h-3.5 no-transition" /> {label}
    </button>
  );
}
