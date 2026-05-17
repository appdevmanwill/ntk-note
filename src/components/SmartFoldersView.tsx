import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { getBacklinks, getOutgoingNoteIds, noteDisplayTitle } from '@/utils/links';
import type { Note } from '@/types';
import type { LucideIcon } from 'lucide-react';
import {
  Archive, BookmarkPlus, CheckSquare, Clock, FolderSearch,
  Link2, Lock, Pin, Save, Search, Star, Trash2, X
} from 'lucide-react';

interface SmartFolder {
  id: string;
  label: string;
  icon: LucideIcon;
  getNotes: (notes: Note[]) => Note[];
}

const smartFolders: SmartFolder[] = [
  {
    id: 'recent',
    label: 'Recently updated',
    icon: Clock,
    getNotes: notes => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 24),
  },
  {
    id: 'pinned',
    label: 'Pinned focus',
    icon: Pin,
    getNotes: notes => notes.filter(note => note.pinned),
  },
  {
    id: 'locked',
    label: 'Locked notes',
    icon: Lock,
    getNotes: notes => notes.filter(note => note.encrypted),
  },
  {
    id: 'tasks',
    label: 'Open checklists',
    icon: CheckSquare,
    getNotes: notes => notes.filter(note => note.type === 'checklist' || note.checklist.some(item => !item.checked)),
  },
  {
    id: 'linked',
    label: 'Connected notes',
    icon: Link2,
    getNotes: notes => notes.filter(note => getBacklinks(note.id, notes).length > 0 || getOutgoingNoteIds(note, notes).length > 0),
  },
  {
    id: 'quiet',
    label: 'Unlinked notes',
    icon: FolderSearch,
    getNotes: notes => notes.filter(note => getBacklinks(note.id, notes).length === 0 && getOutgoingNoteIds(note, notes).length === 0),
  },
  {
    id: 'starred',
    label: 'Starred',
    icon: Star,
    getNotes: notes => notes.filter(note => note.starred),
  },
  {
    id: 'archived',
    label: 'Archived',
    icon: Archive,
    getNotes: notes => notes.filter(note => note.archived && !note.trashed),
  },
  {
    id: 'trash',
    label: 'Trash review',
    icon: Trash2,
    getNotes: notes => notes.filter(note => note.trashed),
  },
];

export default function SmartFoldersView() {
  const {
    notes, savedSearches, searchFilters, saveCurrentSearch,
    applySavedSearch, deleteSavedSearch, selectNote,
  } = useStore();
  const [activeFolderId, setActiveFolderId] = useState('recent');
  const [searchName, setSearchName] = useState('');

  const activeFolder = smartFolders.find(folder => folder.id === activeFolderId) || smartFolders[0];
  const ActiveIcon = activeFolder.icon;
  const activeNotes = useMemo(
    () => activeFolder.getNotes(notes.filter(note => !note.trashed || activeFolder.id === 'trash')),
    [activeFolder, notes]
  );
  const hasActiveSearch =
    !!searchFilters.query ||
    searchFilters.tags.length > 0 ||
    searchFilters.notebooks.length > 0 ||
    searchFilters.colors.length > 0 ||
    searchFilters.types.length > 0 ||
    searchFilters.priorities.length > 0 ||
    searchFilters.hasReminder !== null ||
    searchFilters.hasChecklist !== null ||
    !!searchFilters.dateRange;

  const handleSaveSearch = () => {
    const saved = saveCurrentSearch(searchName || searchFilters.query || 'Saved search');
    setSearchName(saved.name);
    window.setTimeout(() => setSearchName(''), 1200);
  };

  return (
    <div className="flex-1 overflow-y-auto theme-bg">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full accent-soft text-xs font-semibold mb-3">
              <FolderSearch className="w-3.5 h-3.5 no-transition" />
              Smart folders
            </div>
            <h2 className="text-2xl font-bold text-theme-primary">Saved Searches & Smart Folders</h2>
            <p className="text-sm text-theme-tertiary mt-1">Fast views for the notes that need attention.</p>
          </div>
          <div className="rounded-xl theme-card border p-3 min-w-[220px]">
            <p className="text-xs text-theme-tertiary">Saved searches</p>
            <p className="text-2xl font-bold text-theme-primary">{savedSearches.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
          <aside className="space-y-5">
            <div className="rounded-xl theme-card border p-3">
              <div className="space-y-1">
                {smartFolders.map(folder => {
                  const count = folder.getNotes(notes.filter(note => !note.trashed || folder.id === 'trash')).length;
                  const Icon = folder.icon;
                  const active = activeFolderId === folder.id;
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setActiveFolderId(folder.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
                      style={{
                        backgroundColor: active ? 'var(--active-bg)' : 'transparent',
                        color: active ? 'var(--badge-text)' : 'var(--text-secondary)',
                      }}
                    >
                      <Icon className="w-4 h-4 no-transition" />
                      <span className="flex-1 text-left">{folder.label}</span>
                      <span className="text-xs text-theme-tertiary">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl theme-card border p-4">
              <h3 className="font-semibold text-theme-primary mb-3 flex items-center gap-2">
                <BookmarkPlus className="w-4 h-4 no-transition accent-text" />
                Save current search
              </h3>
              <div className="space-y-2">
                <input
                  value={searchName}
                  onChange={event => setSearchName(event.target.value)}
                  placeholder={hasActiveSearch ? 'Name this search' : 'Create from Search view'}
                  className="w-full px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                />
                <button
                  onClick={handleSaveSearch}
                  disabled={!hasActiveSearch && !searchName.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4 no-transition" />
                  Save Search
                </button>
              </div>
            </div>

            <div className="rounded-xl theme-card border p-4">
              <h3 className="font-semibold text-theme-primary mb-3 flex items-center gap-2">
                <Search className="w-4 h-4 no-transition accent-text" />
                Saved searches
              </h3>
              {savedSearches.length === 0 ? (
                <p className="text-sm text-theme-tertiary">No saved searches yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {savedSearches.map(saved => (
                    <div key={saved.id} className="flex items-center gap-1">
                      <button
                        onClick={() => applySavedSearch(saved.id)}
                        className="flex-1 text-left px-3 py-2 rounded-lg theme-hover text-sm text-theme-secondary"
                      >
                        {saved.name}
                      </button>
                      <button
                        onClick={() => deleteSavedSearch(saved.id)}
                        className="p-2 rounded-lg theme-hover text-theme-tertiary"
                        aria-label={`Delete ${saved.name}`}
                      >
                        <X className="w-4 h-4 no-transition" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="rounded-xl theme-card border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
              <div className="flex items-center gap-2">
                <ActiveIcon className="w-4 h-4 no-transition accent-text" />
                <h3 className="font-semibold text-theme-primary">{activeFolder.label}</h3>
              </div>
              <span className="text-xs text-theme-tertiary">{activeNotes.length} notes</span>
            </div>
            {activeNotes.length === 0 ? (
              <div className="p-10 text-center">
                <FolderSearch className="w-10 h-10 text-theme-muted mx-auto mb-3 no-transition" />
                <p className="font-medium text-theme-primary">Nothing here right now</p>
              </div>
            ) : (
              <div className="divide-y theme-divider">
                {activeNotes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => selectNote(note.id)}
                    className="w-full text-left p-4 theme-hover flex items-start gap-3"
                  >
                    <div className="w-10 h-10 rounded-lg accent-soft flex items-center justify-center shrink-0">
                      {note.encrypted ? <Lock className="w-4 h-4 no-transition" /> : <Search className="w-4 h-4 no-transition" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-theme-primary truncate">{noteDisplayTitle(note)}</p>
                      <p className="text-sm text-theme-tertiary truncate">
                        {note.encrypted ? 'Locked note' : note.content.replace(/<[^>]*>/g, '').slice(0, 120) || 'Empty note'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {note.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
