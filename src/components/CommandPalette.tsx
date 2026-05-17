import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import {
  Search, FileText, Plus, Moon, Sun, Home, Star,
  Archive, Trash2, Settings, CheckSquare, Code,
  LayoutTemplate, GitBranch, FolderSearch
} from 'lucide-react';

interface Command {
  id: string;
  icon: typeof FileText;
  label: string;
  description?: string;
  action: () => void;
  category: string;
}

export default function CommandPalette() {
  const {
    commandPaletteOpen, setCommandPaletteOpen,
    createNote, setCurrentView, setTheme, settings,
    notes, selectNote, toggleZenMode,
  } = useStore();

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
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

  const commands: Command[] = [
    { id: 'new-note', icon: Plus, label: 'New Note', category: 'Actions', action: () => { createNote({ type: 'note' }); setCommandPaletteOpen(false); } },
    { id: 'new-checklist', icon: CheckSquare, label: 'New Checklist', category: 'Actions', action: () => { createNote({ type: 'checklist' }); setCommandPaletteOpen(false); } },
    { id: 'new-markdown', icon: Code, label: 'New Markdown Note', category: 'Actions', action: () => { createNote({ type: 'markdown' }); setCommandPaletteOpen(false); } },
    { id: 'zen', icon: FileText, label: 'Toggle Zen Mode', category: 'Actions', action: () => { toggleZenMode(); setCommandPaletteOpen(false); } },
    { id: 'theme', icon: settings.theme === 'light' ? Moon : Sun, label: `Switch to ${settings.theme === 'light' ? 'Dark' : 'Light'} Mode`, category: 'Actions', action: () => { setTheme(settings.theme === 'light' ? 'dark' : 'light'); setCommandPaletteOpen(false); } },
    { id: 'home', icon: Home, label: 'Go to Home', category: 'Navigation', action: () => { setCurrentView('home'); setCommandPaletteOpen(false); } },
    { id: 'all-notes', icon: FileText, label: 'All Notes', category: 'Navigation', action: () => { setCurrentView('all-notes'); setCommandPaletteOpen(false); } },
    { id: 'starred', icon: Star, label: 'Starred Notes', category: 'Navigation', action: () => { setCurrentView('starred'); setCommandPaletteOpen(false); } },
    { id: 'archived', icon: Archive, label: 'Archived Notes', category: 'Navigation', action: () => { setCurrentView('archived'); setCommandPaletteOpen(false); } },
    { id: 'trash', icon: Trash2, label: 'Trash', category: 'Navigation', action: () => { setCurrentView('trash'); setCommandPaletteOpen(false); } },
    { id: 'smart-folders', icon: FolderSearch, label: 'Smart Folders', category: 'Navigation', action: () => { setCurrentView('smart-folders'); setCommandPaletteOpen(false); } },
    { id: 'graph', icon: GitBranch, label: 'Graph View', category: 'Navigation', action: () => { setCurrentView('graph'); setCommandPaletteOpen(false); } },
    { id: 'templates', icon: LayoutTemplate, label: 'Templates', category: 'Navigation', action: () => { setCurrentView('templates'); setCommandPaletteOpen(false); } },
    { id: 'settings', icon: Settings, label: 'Settings', category: 'Navigation', action: () => { setCurrentView('settings'); setCommandPaletteOpen(false); } },
    // Recent notes
    ...notes.filter(n => !n.trashed).slice(0, 10).map(n => ({
      id: `note-${n.id}`,
      icon: n.type === 'checklist' ? CheckSquare : n.type === 'markdown' ? Code : FileText,
      label: n.title || 'Untitled',
      description: n.encrypted ? 'Locked note' : n.content.slice(0, 50),
      category: 'Recent Notes',
      action: () => { selectNote(n.id); setCommandPaletteOpen(false); },
    })),
  ];

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()) || c.description?.toLowerCase().includes(query.toLowerCase()))
    : commands;

  const categories = [...new Set(filtered.map(c => c.category))];

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
            onChange={e => setQuery(e.target.value)}
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
          {filtered.length === 0 && (
            <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>No results found</p>
          )}
          {categories.map(cat => (
            <div key={cat}>
              <p className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{cat}</p>
              {filtered.filter(c => c.category === cat).map(cmd => (
                <button
                  key={cmd.id}
                  onClick={cmd.action}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm theme-hover transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <cmd.icon className="w-4 h-4 shrink-0 no-transition" style={{ color: 'var(--text-tertiary)' }} />
                  <span className="flex-1 text-left truncate">{cmd.label}</span>
                  {cmd.description && (
                    <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--text-muted)' }}>{cmd.description}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
