import { useState } from 'react';
import { useStore } from '@/store';
import NoteCard from './NoteCard';
import ShareModal from './ShareModal';
import {
  Plus, FileText, Search, Grid3X3, List, SlidersHorizontal,
  X, CheckSquare, Code, Trash2, ArrowUpDown, Archive,
  FolderInput, Tag, MoreHorizontal, CheckCircle2, PanelLeftClose, Kanban, Share2
} from 'lucide-react';
import type { NoteColor, NoteType } from '@/types';
import { noteColors } from '@/utils/colors';

export default function NoteList({ onCollapsePanel }: { onCollapsePanel?: () => void }) {
  const {
    currentView, getFilteredNotes, searchFilters, setSearchFilters,
    clearSearch, createNote, emptyTrash, settings, updateSettings,
    selectedNotebookId, selectedTagId, notebooks, tags,
    trashNote, archiveNote, moveNote, addNoteTag,
    updateNote, setNotePriority, addSection, deleteSection,
  } = useStore();

  const [showFilters, setShowFilters] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const filteredNotes = getFilteredNotes();
  const gridGap = settings.density === 'compact' ? 'gap-2' : settings.density === 'spacious' ? 'gap-4' : 'gap-3';
  const listGap = settings.density === 'compact' ? 'space-y-1.5' : settings.density === 'spacious' ? 'space-y-3' : 'space-y-2';

  const viewTitles: Record<string, string> = {
    'all-notes': 'All Notes',
    'starred': 'Starred',
    'reminders': 'Reminders',
    'archived': 'Archived',
    'trash': 'Trash',
    'shared': 'Shared Notes',
    'search': 'Search',
    'notebooks': notebooks.find(nb => nb.id === selectedNotebookId)?.name || 'Notebook',
    'tags': tags.find(t => t.id === selectedTagId)?.name || 'Tag',
  };

  const title = viewTitles[currentView] || 'Notes';

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredNotes.map(n => n.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkMode(false);
  };

  const handleBulkTrash = () => {
    selectedIds.forEach(id => trashNote(id));
    clearSelection();
  };

  const handleBulkArchive = () => {
    selectedIds.forEach(id => archiveNote(id));
    clearSelection();
  };

  const handleBulkMove = (notebookId: string) => {
    selectedIds.forEach(id => moveNote(id, notebookId));
    clearSelection();
    setShowBulkMoveMenu(false);
  };

  const handleBulkTag = () => {
    if (bulkTagInput.trim()) {
      selectedIds.forEach(id => addNoteTag(id, bulkTagInput.trim()));
      setBulkTagInput('');
      setShowBulkTagInput(false);
    }
  };

  const renderKanbanBoard = () => {
    if (currentView === 'notebooks' && selectedNotebookId) {
      const notebook = notebooks.find(nb => nb.id === selectedNotebookId);
      const sections = notebook?.sections || [];
      
      const columns = [
        { id: 'unassigned', name: 'Unassigned' },
        ...sections.map(sec => ({ id: sec.id, name: sec.name }))
      ];

      return (
        <>
          {columns.map(col => {
            const colNotes = filteredNotes.filter(n => 
              col.id === 'unassigned' 
                ? !n.sectionId || !sections.some(s => s.id === n.sectionId)
                : n.sectionId === col.id
            );

            return (
              <div 
                key={col.id} 
                className="w-72 shrink-0 flex flex-col h-[calc(100vh-180px)] bg-[var(--app-bg-subtle)]/40 border theme-divider rounded-xl p-3"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  const noteId = e.dataTransfer.getData('text/plain');
                  if (noteId) {
                    void updateNote(noteId, { 
                      sectionId: col.id === 'unassigned' ? undefined : col.id 
                    });
                  }
                }}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3 pb-1 border-b theme-divider">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-theme-secondary truncate">
                      {col.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full accent-soft font-bold shrink-0">
                      {colNotes.length}
                    </span>
                  </div>
                  {col.id !== 'unassigned' && (
                    <button 
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete section "${col.name}"? Notes in this section will be unassigned.`)) {
                          void deleteSection(selectedNotebookId, col.id);
                        }
                      }}
                      className="p-1 rounded theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 no-transition" />
                    </button>
                  )}
                </div>

                {/* Column Body */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {colNotes.length === 0 ? (
                    <div className="h-20 border border-dashed theme-divider rounded-lg flex items-center justify-center text-xs text-theme-muted italic">
                      Empty
                    </div>
                  ) : (
                    colNotes.map(note => (
                      <div 
                        key={note.id} 
                        draggable 
                        onDragStart={e => e.dataTransfer.setData('text/plain', note.id)}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <NoteCard note={note} compact />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}

          {/* Add Section Column */}
          <div className="w-72 shrink-0 border-2 border-dashed theme-divider rounded-xl p-4 flex flex-col items-center justify-center gap-2 bg-[var(--app-bg-subtle)]/10 hover:bg-[var(--app-bg-subtle)]/25 transition-colors h-36">
            <Plus className="w-6 h-6 text-theme-tertiary no-transition" />
            <button 
              onClick={() => {
                const name = prompt('Enter section name:');
                if (name && name.trim()) {
                  void addSection(selectedNotebookId, name.trim());
                }
              }}
              className="text-xs font-bold uppercase tracking-wider accent-text cursor-pointer hover:underline"
            >
              + Add Section
            </button>
          </div>
        </>
      );
    } else {
      // General Mode: Group by Priority
      const priorityColumns = [
        { id: 'unassigned', name: 'Unassigned', priority: null },
        { id: 'low', name: 'Low Priority', priority: 'low' as const },
        { id: 'medium', name: 'Medium Priority', priority: 'medium' as const },
        { id: 'high', name: 'High Priority', priority: 'high' as const },
        { id: 'urgent', name: 'Urgent', priority: 'urgent' as const }
      ];

      return (
        <>
          {priorityColumns.map(col => {
            const colNotes = filteredNotes.filter(n => n.priority === col.priority);

            return (
              <div 
                key={col.id} 
                className="w-72 shrink-0 flex flex-col h-[calc(100vh-180px)] bg-[var(--app-bg-subtle)]/40 border theme-divider rounded-xl p-3"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  const noteId = e.dataTransfer.getData('text/plain');
                  if (noteId) {
                    void setNotePriority(noteId, col.priority);
                  }
                }}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3 pb-1 border-b theme-divider">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-theme-secondary truncate">
                      {col.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full accent-soft font-bold shrink-0">
                      {colNotes.length}
                    </span>
                  </div>
                </div>

                {/* Column Body */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {colNotes.length === 0 ? (
                    <div className="h-20 border border-dashed theme-divider rounded-lg flex items-center justify-center text-xs text-theme-muted italic">
                      Empty
                    </div>
                  ) : (
                    colNotes.map(note => (
                      <div 
                        key={note.id} 
                        draggable 
                        onDragStart={e => e.dataTransfer.setData('text/plain', note.id)}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <NoteCard note={note} compact />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </>
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--app-bg)' }}>
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-theme-primary">{title}</h2>
            {currentView === 'notebooks' && selectedNotebookId && (
              <button
                onClick={() => setShowShareModal(true)}
                className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
                title="Share this Notebook"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            {bulkMode && (
              <span className="text-sm font-medium accent-text">
                {selectedIds.size} selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onCollapsePanel && (
              <button
                type="button"
                onClick={onCollapsePanel}
                className="hidden lg:inline-flex p-2 rounded-lg theme-hover text-theme-tertiary"
                title="Collapse notes list"
                aria-label="Collapse notes list"
              >
                <PanelLeftClose className="w-4 h-4 no-transition" />
              </button>
            )}

            {/* Bulk mode toggle */}
            {filteredNotes.length > 0 && currentView !== 'trash' && (
              <button
                onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
                className="p-2 rounded-lg transition-colors"
                title="Bulk select"
                style={{
                  backgroundColor: bulkMode ? 'var(--active-bg)' : 'transparent',
                  color: bulkMode ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                }}
              >
                <CheckCircle2 className="w-4 h-4 no-transition" />
              </button>
            )}

            {/* Bulk actions */}
            {bulkMode && selectedIds.size > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowBulkMenu(!showBulkMenu)}
                  className="p-2 rounded-lg accent-button"
                >
                  <MoreHorizontal className="w-4 h-4 no-transition" />
                </button>
                {showBulkMenu && (
                  <div className="absolute right-0 top-10 z-30 w-48 rounded-xl py-1.5 animate-scale-in theme-menu border">
                    <button
                      onClick={() => { selectAll(); setShowBulkMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-hover"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <CheckCircle2 className="w-4 h-4 no-transition" /> Select all
                    </button>
                    <button
                      onClick={() => setShowBulkTagInput(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-hover"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Tag className="w-4 h-4 no-transition" /> Add tag
                    </button>
                    <button
                      onClick={() => setShowBulkMoveMenu(true)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-hover"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <FolderInput className="w-4 h-4 no-transition" /> Move to...
                    </button>
                    <button
                      onClick={handleBulkArchive}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-hover"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Archive className="w-4 h-4 no-transition" /> Archive
                    </button>
                    <div className="my-1 border-t theme-divider" />
                    <button
                      onClick={handleBulkTrash}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4 no-transition" /> Move to trash
                    </button>

                    {/* Bulk tag input */}
                    {showBulkTagInput && (
                      <div className="px-3 py-2 border-t theme-divider">
                        <input
                          type="text"
                          value={bulkTagInput}
                          onChange={e => setBulkTagInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleBulkTag()}
                          placeholder="Tag name..."
                          className="w-full px-2 py-1.5 text-sm rounded-lg theme-input border-none focus:outline-none accent-focus"
                          autoFocus
                        />
                      </div>
                    )}

                    {/* Bulk move menu */}
                    {showBulkMoveMenu && (
                      <div className="px-3 py-2 border-t theme-divider max-h-32 overflow-y-auto">
                        {notebooks.map(nb => (
                          <button
                            key={nb.id}
                            onClick={() => handleBulkMove(nb.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm theme-hover"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            <span>{nb.icon}</span> {nb.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {bulkMode && (
              <button
                onClick={clearSelection}
                className="px-3 py-1.5 rounded-lg text-sm theme-hover"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Cancel
              </button>
            )}

            {!bulkMode && (
              <>
                {/* View mode toggle */}
                <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: 'var(--input-bg)' }}>
                  <button
                    onClick={() => updateSettings({ noteViewMode: 'grid' })}
                    className="p-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: settings.noteViewMode === 'grid' ? 'var(--card-bg)' : 'transparent',
                      boxShadow: settings.noteViewMode === 'grid' ? 'var(--card-shadow)' : 'none',
                      color: 'var(--text-secondary)',
                    }}
                    title="Grid View"
                  >
                    <Grid3X3 className="w-4 h-4 no-transition" />
                  </button>
                  <button
                    onClick={() => updateSettings({ noteViewMode: 'list' })}
                    className="p-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: settings.noteViewMode === 'list' ? 'var(--card-bg)' : 'transparent',
                      boxShadow: settings.noteViewMode === 'list' ? 'var(--card-shadow)' : 'none',
                      color: 'var(--text-secondary)',
                    }}
                    title="List View"
                  >
                    <List className="w-4 h-4 no-transition" />
                  </button>
                  <button
                    onClick={() => updateSettings({ noteViewMode: 'kanban' })}
                    className="p-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: settings.noteViewMode === 'kanban' ? 'var(--card-bg)' : 'transparent',
                      boxShadow: settings.noteViewMode === 'kanban' ? 'var(--card-shadow)' : 'none',
                      color: 'var(--text-secondary)',
                    }}
                    title="Kanban Board View"
                  >
                    <Kanban className="w-4 h-4 no-transition" />
                  </button>
                </div>

                {/* Sort */}
                <button
                  onClick={() => setSearchFilters({
                    sortDir: searchFilters.sortDir === 'desc' ? 'asc' : 'desc'
                  })}
                  className="p-2 rounded-lg theme-hover"
                  title="Toggle sort order"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <ArrowUpDown className="w-4 h-4 no-transition" />
                </button>

                {/* Filters */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="p-2 rounded-lg transition-colors"
                  style={{
                    backgroundColor: showFilters ? 'var(--active-bg)' : 'transparent',
                    color: showFilters ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                  }}
                >
                  <SlidersHorizontal className="w-4 h-4 no-transition" />
                </button>

                {/* New note */}
                {currentView !== 'trash' && currentView !== 'archived' && (
                  <button
                    onClick={() => createNote({
                      notebookId: currentView === 'notebooks' && selectedNotebookId ? selectedNotebookId : undefined,
                    })}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg accent-button text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4 no-transition" />
                    <span className="hidden sm:inline">New Note</span>
                  </button>
                )}

                {/* Empty trash */}
                {currentView === 'trash' && filteredNotes.length > 0 && (
                  <button
                    onClick={emptyTrash}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 no-transition" /> Empty Trash
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Search bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 no-transition" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchFilters.query}
            onChange={e => setSearchFilters({ query: e.target.value })}
            placeholder="Search notes..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border text-sm focus:outline-none accent-focus theme-input"
          />
          {searchFilters.query && (
            <button
              onClick={() => setSearchFilters({ query: '' })}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="w-4 h-4 no-transition" />
            </button>
          )}
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="mb-3 p-3 rounded-xl border space-y-3 animate-fade-in theme-card">
            {/* Type filter */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Type</p>
              <div className="flex gap-1.5">
                {([['note', FileText, 'Note'], ['checklist', CheckSquare, 'Checklist'], ['markdown', Code, 'Markdown']] as [NoteType, typeof FileText, string][]).map(([type, Icon, label]) => (
                  <button
                    key={type}
                    onClick={() => {
                      const types = searchFilters.types.includes(type)
                        ? searchFilters.types.filter(t => t !== type)
                        : [...searchFilters.types, type];
                      setSearchFilters({ types });
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: searchFilters.types.includes(type) ? 'var(--active-bg)' : 'var(--input-bg)',
                      color: searchFilters.types.includes(type) ? 'var(--badge-text)' : 'var(--text-tertiary)',
                    }}
                  >
                    <Icon className="w-3.5 h-3.5 no-transition" /> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Color filter */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Color</p>
              <div className="flex gap-1.5 flex-wrap">
                {(Object.keys(noteColors) as NoteColor[]).map(c => (
                  <button
                    key={c}
                    onClick={() => {
                      const colors = searchFilters.colors.includes(c)
                        ? searchFilters.colors.filter(x => x !== c)
                        : [...searchFilters.colors, c];
                      setSearchFilters({ colors });
                    }}
                    className={`w-6 h-6 rounded-full ${noteColors[c].dot} ${
                      searchFilters.colors.includes(c) ? 'ring-2 ring-offset-2' : ''
                    } hover:scale-110 transition-transform`}
                    style={searchFilters.colors.includes(c) ? { '--tw-ring-offset-color': 'var(--card-bg)' } as React.CSSProperties : {}}
                    title={noteColors[c].label}
                  />
                ))}
              </div>
            </div>

            {/* Quick filters */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Quick filters</p>
              <div className="flex gap-1.5 flex-wrap">
                <FilterChip
                  label="Has reminder"
                  active={searchFilters.hasReminder === true}
                  onClick={() => setSearchFilters({ hasReminder: searchFilters.hasReminder === true ? null : true })}
                />
                <FilterChip
                  label="Has checklist"
                  active={searchFilters.hasChecklist === true}
                  onClick={() => setSearchFilters({ hasChecklist: searchFilters.hasChecklist === true ? null : true })}
                />
              </div>
            </div>

            {/* Sort */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Sort by</p>
              <div className="flex gap-1.5 flex-wrap">
                {(['updatedAt', 'createdAt', 'title', 'priority'] as const).map(s => (
                  <FilterChip
                    key={s}
                    label={s === 'updatedAt' ? 'Last modified' : s === 'createdAt' ? 'Created' : s === 'title' ? 'Title' : 'Priority'}
                    active={searchFilters.sortBy === s}
                    onClick={() => setSearchFilters({ sortBy: s })}
                  />
                ))}
              </div>
            </div>

            {/* Clear filters */}
            <button
              onClick={clearSearch}
              className="text-xs font-medium accent-text"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Notes grid/list/kanban */}
      {settings.noteViewMode === 'kanban' ? (
        <div className="flex-1 overflow-x-auto flex gap-4 px-4 md:px-6 pb-24 lg:pb-6 items-start h-full">
          {renderKanbanBoard()}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-24 lg:pb-6">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-16 h-16 mx-auto mb-4 no-transition" style={{ color: 'var(--text-muted)' }} />
              <h3 className="text-lg font-medium text-theme-secondary">
                {searchFilters.query ? 'No matching notes' : currentView === 'trash' ? 'Trash is empty' : 'No notes yet'}
              </h3>
              <p className="text-sm text-theme-tertiary mt-1">
                {searchFilters.query ? 'Try a different search term' : 'Create a note to get started'}
              </p>
            </div>
          ) : (
            <div className={
              settings.noteViewMode === 'grid'
                ? `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${gridGap}`
                : listGap
            }>
              {filteredNotes.map(note => (
                <div key={note.id} className="relative">
                  {bulkMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(note.id); }}
                      className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        selectedIds.has(note.id)
                          ? 'accent-button border-transparent'
                          : ''
                      }`}
                      style={!selectedIds.has(note.id) ? {
                        backgroundColor: 'var(--card-bg)',
                        borderColor: 'var(--text-muted)',
                      } : {}}
                    >
                      {selectedIds.has(note.id) && (
                        <svg className="w-3 h-3 no-transition" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  )}
                  <NoteCard note={note} compact={settings.noteViewMode === 'list'} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {selectedNotebookId && (
        <ShareModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          entityType="notebook"
          entityId={selectedNotebookId}
        />
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? 'var(--active-bg)' : 'var(--input-bg)',
        color: active ? 'var(--badge-text)' : 'var(--text-tertiary)',
      }}
    >
      {label}
    </button>
  );
}
