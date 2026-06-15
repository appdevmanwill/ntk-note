import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import {
  Search, FileText, Plus, Moon, Sun, Home, Star,
  Archive, Trash2, Settings, CheckSquare, Code,
  LayoutTemplate, GitBranch, FolderSearch, Tag, Pin, FolderInput, BookOpen,
  Download, History, Cloud, Clipboard, HardDrive
} from 'lucide-react';
import { copyAsMarkdown, copyAsPlainText, exportToPDF, loadNoteExportOptions } from '@/utils/export';
import { saveCloudNoteCheckpoint, saveLocalNoteSnapshot } from './VersionHistory';

interface Command {
  id: string;
  icon: typeof FileText;
  label: string;
  description?: string;
  action: () => void | Promise<void>;
  category: string;
}

export default function CommandPalette() {
  const {
    commandPaletteOpen, setCommandPaletteOpen,
    createNote, setCurrentView, setTheme, settings,
    notes, notebooks, tags, savedSearches,
    selectedNoteId, selectNote, selectNotebook, selectTag,
    toggleZenMode, createNotebook, moveNote, addNoteTag,
    archiveNote, unarchiveNote, pinNote, starNote, trashNote, applySavedSearch,
    uid,
  } = useStore();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentNote = notes.find(note => note.id === selectedNoteId);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  const close = () => setCommandPaletteOpen(false);
  const openSettingsSection = (section: string) => {
    setCurrentView('settings');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('ntk-settings-section', { detail: section }));
    }, 0);
    close();
  };
  const normalizedQuery = query.trim().toLowerCase();
  const createNotebookMatch = query.trim().match(/^new notebook\s+(.+)/i);
  const createNamedNotebook = createNotebookMatch?.[1]?.trim() || '';
  const tagMatch = query.trim().match(/^tag\s+(.+)/i);
  const tagName = tagMatch?.[1]?.trim() || '';

  const commands: Command[] = [
    { id: 'new-note', icon: Plus, label: 'New Note', category: 'Actions', action: () => { void createNote({ type: 'note' }); close(); } },
    { id: 'new-checklist', icon: CheckSquare, label: 'New Checklist', category: 'Actions', action: () => { void createNote({ type: 'checklist' }); close(); } },
    { id: 'new-markdown', icon: Code, label: 'New Markdown Note', category: 'Actions', action: () => { void createNote({ type: 'markdown' }); close(); } },
    { id: 'new-notebook', icon: BookOpen, label: createNamedNotebook ? `Create notebook "${createNamedNotebook}"` : 'Create Notebook', description: 'Type: new notebook Work', category: 'Actions', action: () => { createNotebook(createNamedNotebook || 'New Notebook'); close(); } },
    { id: 'zen', icon: FileText, label: 'Toggle Zen Mode', category: 'Actions', action: () => { toggleZenMode(); close(); } },
    { id: 'theme', icon: settings.theme === 'light' ? Moon : Sun, label: `Switch to ${settings.theme === 'light' ? 'Dark' : 'Light'} Mode`, category: 'Actions', action: () => { setTheme(settings.theme === 'light' ? 'dark' : 'light'); close(); } },
    { id: 'home', icon: Home, label: 'Go to Home', category: 'Navigation', action: () => { setCurrentView('home'); close(); } },
    { id: 'all-notes', icon: FileText, label: 'All Notes', category: 'Navigation', action: () => { setCurrentView('all-notes'); close(); } },
    { id: 'starred', icon: Star, label: 'Starred Notes', category: 'Navigation', action: () => { setCurrentView('starred'); close(); } },
    { id: 'archived', icon: Archive, label: 'Archived Notes', category: 'Navigation', action: () => { setCurrentView('archived'); close(); } },
    { id: 'trash', icon: Trash2, label: 'Trash', category: 'Navigation', action: () => { setCurrentView('trash'); close(); } },
    { id: 'smart-folders', icon: FolderSearch, label: 'Smart Folders', category: 'Navigation', action: () => { setCurrentView('smart-folders'); close(); } },
    { id: 'graph', icon: GitBranch, label: 'Graph View', category: 'Navigation', action: () => { setCurrentView('graph'); close(); } },
    { id: 'templates', icon: LayoutTemplate, label: 'Templates', category: 'Navigation', action: () => { setCurrentView('templates'); close(); } },
    { id: 'settings', icon: Settings, label: 'Settings', category: 'Navigation', action: () => { setCurrentView('settings'); close(); } },
    { id: 'storage-health', icon: HardDrive, label: 'Open storage health', category: 'Navigation', action: () => openSettingsSection('data') },
    ...(currentNote ? [
      { id: 'pin-current', icon: Pin, label: currentNote.pinned ? 'Unpin current note' : 'Pin current note', category: 'Current Note', action: () => { void pinNote(currentNote.id); close(); } },
      { id: 'star-current', icon: Star, label: currentNote.starred ? 'Unstar current note' : 'Star current note', category: 'Current Note', action: () => { void starNote(currentNote.id); close(); } },
      { id: 'archive-current', icon: Archive, label: currentNote.archived ? 'Unarchive current note' : 'Archive current note', category: 'Current Note', action: () => { void (currentNote.archived ? unarchiveNote(currentNote.id) : archiveNote(currentNote.id)); close(); } },
      { id: 'trash-current', icon: Trash2, label: 'Move current note to trash', category: 'Current Note', action: () => { void trashNote(currentNote.id); close(); } },
      { id: 'snapshot-current', icon: History, label: 'Save local snapshot', description: 'Device recovery copy', category: 'Current Note', action: () => { saveLocalNoteSnapshot(currentNote.id, currentNote.title, currentNote.content, 'manual'); close(); } },
      { id: 'checkpoint-current', icon: Cloud, label: 'Save cloud checkpoint', description: currentNote.encrypted ? 'Encrypted notes stay local' : 'Synced important version', category: 'Current Note', action: async () => {
        if (currentNote.encrypted) {
          saveLocalNoteSnapshot(currentNote.id, currentNote.title, currentNote.content, 'cloud-checkpoint');
        } else {
          try {
            await saveCloudNoteCheckpoint(uid, currentNote.id, currentNote.title, currentNote.content);
          } catch (error) {
            alert(error instanceof Error ? error.message : 'Cloud checkpoint failed.');
          }
        }
        close();
      } },
      { id: 'export-pdf-current', icon: Download, label: 'Export current note as PDF', category: 'Current Note', action: async () => { await exportToPDF(currentNote, loadNoteExportOptions()); close(); } },
      { id: 'copy-markdown-current', icon: Code, label: 'Copy current note as Markdown', category: 'Current Note', action: () => { copyAsMarkdown(currentNote, loadNoteExportOptions()); close(); } },
      { id: 'copy-text-current', icon: Clipboard, label: 'Copy current note as plain text', category: 'Current Note', action: () => { copyAsPlainText(currentNote, loadNoteExportOptions()); close(); } },
      ...(tagName ? [{ id: 'tag-current', icon: Tag, label: `Tag current note "${tagName}"`, category: 'Current Note', action: () => { void addNoteTag(currentNote.id, tagName); close(); } }] : []),
      ...notebooks.filter(nb => !nb.trashed).map(nb => ({
        id: `move-${nb.id}`,
        icon: FolderInput,
        label: `Move current note to ${nb.name}`,
        description: nb.icon,
        category: 'Move Current Note',
        action: () => { void moveNote(currentNote.id, nb.id); close(); },
      })),
    ] : []),
    ...savedSearches.map(saved => ({
      id: `saved-${saved.id}`,
      icon: FolderSearch,
      label: saved.name,
      description: 'Saved smart view',
      category: 'Saved Views',
      action: () => { applySavedSearch(saved.id); close(); },
    })),
    ...notebooks.filter(nb => !nb.trashed).map(nb => ({
      id: `notebook-${nb.id}`,
      icon: BookOpen,
      label: nb.name,
      description: 'Open notebook',
      category: 'Notebooks',
      action: () => { selectNotebook(nb.id); setCurrentView('notebooks'); close(); },
    })),
    ...tags.map(tag => ({
      id: `tag-${tag.id}`,
      icon: Tag,
      label: tag.name,
      description: `${tag.count} notes`,
      category: 'Tags',
      action: () => { selectTag(tag.id); setCurrentView('tags'); close(); },
    })),
    ...notes.filter(n => !n.trashed).map(n => ({
      id: `note-${n.id}`,
      icon: n.type === 'checklist' ? CheckSquare : n.type === 'markdown' ? Code : FileText,
      label: n.title || 'Untitled',
      description: n.encrypted ? 'Locked note' : `${n.content.replace(/<[^>]*>/g, '').slice(0, 80)} ${n.tags.map(tag => `#${tag}`).join(' ')}`,
      category: 'Notes',
      action: () => { selectNote(n.id); close(); },
    })),
  ];

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(normalizedQuery) || c.description?.toLowerCase().includes(normalizedQuery))
    : commands;
  const visibleCommands = filtered.slice(0, 80);

  const categories = [...new Set(visibleCommands.map(c => c.category))];

  const runCommand = (cmd: Command) => {
    void cmd.action();
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCommandPaletteOpen(false)} />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden animate-scale-in theme-menu"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b theme-divider">
          <Search className="w-5 h-5 no-transition" style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(idx => Math.min(idx + 1, visibleCommands.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(idx => Math.max(idx - 1, 0));
              }
              if (e.key === 'Enter' && visibleCommands[selectedIndex]) {
                e.preventDefault();
                runCommand(visibleCommands[selectedIndex]);
              }
            }}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text-muted)' }}
          >
            ESC
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {visibleCommands.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>No results found</p>
          )}
          {categories.map(cat => (
            <div key={cat}>
              <p className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{cat}</p>
              {visibleCommands.filter(c => c.category === cat).map(cmd => {
                const index = visibleCommands.findIndex(item => item.id === cmd.id);
                return (
                <button
                  key={cmd.id}
                  onClick={() => runCommand(cmd)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm theme-hover transition-colors"
                  style={{
                    color: 'var(--text-secondary)',
                    backgroundColor: index === selectedIndex ? 'var(--active-bg)' : undefined,
                  }}
                >
                  <cmd.icon className="w-4 h-4 shrink-0 no-transition" style={{ color: 'var(--text-tertiary)' }} />
                  <span className="flex-1 text-left truncate">{cmd.label}</span>
                  {cmd.description && (
                    <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>{cmd.description}</span>
                  )}
                </button>
              );})}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
