import { useState } from 'react';
import { useStore } from '@/store';
import NoteCard from './NoteCard';
import ShareModal from './ShareModal';
import {
  Plus, FileText, Search, Grid3X3, List, SlidersHorizontal,
  X, CheckSquare, Code, Trash2, ArrowUpDown, Archive,
  FolderInput, Tag, MoreHorizontal, CheckCircle2, PanelLeftClose, Kanban, Share2,
  GripVertical, Pencil, Check
} from 'lucide-react';
import type { Note, NoteColor, NoteSortBy, NoteType, Priority, SortDirection } from '@/types';
import { noteColors } from '@/utils/colors';

interface NoteSortOption {
  label: string;
  sortBy: NoteSortBy;
  sortDir: SortDirection;
}

const noteSortOptions: NoteSortOption[] = [
  { label: 'Manual order', sortBy: 'order', sortDir: 'asc' },
  { label: 'Recently updated', sortBy: 'updatedAt', sortDir: 'desc' },
  { label: 'Oldest updated', sortBy: 'updatedAt', sortDir: 'asc' },
  { label: 'Newest created', sortBy: 'createdAt', sortDir: 'desc' },
  { label: 'Oldest created', sortBy: 'createdAt', sortDir: 'asc' },
  { label: 'Title A-Z', sortBy: 'title', sortDir: 'asc' },
  { label: 'Title Z-A', sortBy: 'title', sortDir: 'desc' },
  { label: 'Priority high-low', sortBy: 'priority', sortDir: 'desc' },
  { label: 'Priority low-high', sortBy: 'priority', sortDir: 'asc' },
  { label: 'Longest notes', sortBy: 'wordCount', sortDir: 'desc' },
  { label: 'Shortest notes', sortBy: 'wordCount', sortDir: 'asc' },
];

export default function NoteList({ onCollapsePanel }: { onCollapsePanel?: () => void }) {
  const {
    currentView, getFilteredNotes, searchFilters, setSearchFilters,
    clearSearch, createNote, emptyTrash, settings, updateSettings,
    selectedNotebookId, selectedTagId, notebooks, tags,
    archiveNote, moveNote, addNoteTag,
    updateNote, addSection, updateSection, deleteSection, notes,
    restoreNote, bulkTrashNotes, bulkDeleteNotes, deleteNotebook,
    restoreNotebook, permanentlyDeleteNotebook, reorderNotes,
  } = useStore();

  const [showFilters, setShowFilters] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [showBulkTagInput, setShowBulkTagInput] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [showBulkMoveMenu, setShowBulkMoveMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [draggedNoteId, setDraggedNoteId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');

  const filteredNotes = getFilteredNotes();
  const trashedNotebooks = notebooks.filter(nb => nb.trashed);
  
  const sharedByOptions = Array.from(new Set(notes.filter(n => n.sharedBy).map(n => n.sharedBy as string)));
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
  const activeSortValue = `${searchFilters.sortBy}:${searchFilters.sortDir}`;
  const activeNotebook = currentView === 'notebooks' && selectedNotebookId
    ? notebooks.find(nb => nb.id === selectedNotebookId)
    : null;
  const canCreateNoteHere = currentView !== 'trash' && currentView !== 'archived';

  const handleCreateNoteHere = () => {
    void createNote({
      notebookId: activeNotebook ? activeNotebook.id : undefined,
    });
  };

  const handleSortChange = (value: string) => {
    const option = noteSortOptions.find(item => `${item.sortBy}:${item.sortDir}` === value);
    if (!option) return;
    setSearchFilters({ sortBy: option.sortBy, sortDir: option.sortDir });
  };

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
    bulkTrashNotes(Array.from(selectedIds));
    setBulkMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkRestore = () => {
    selectedIds.forEach(id => restoreNote(id));
    setBulkMode(false);
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    if (confirm('Are you sure you want to permanently delete these notes? This cannot be undone.')) {
      bulkDeleteNotes(Array.from(selectedIds));
      setBulkMode(false);
      setSelectedIds(new Set());
    }
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

  const getDragNoteId = (e: React.DragEvent) =>
    e.dataTransfer.getData('application/x-ntk-note-id') || e.dataTransfer.getData('text/plain');

  const beginNoteDrag = (e: React.DragEvent, noteId: string) => {
    if (bulkMode || currentView === 'trash') {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-ntk-note-id', noteId);
    e.dataTransfer.setData('text/plain', noteId);
    setDraggedNoteId(noteId);
  };

  const dropNoteAt = async (
    e: React.DragEvent,
    targetNoteId: string | null,
    updates: Partial<Pick<Note, 'sectionId' | 'priority'>> = {}
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const noteId = getDragNoteId(e);
    if (!noteId || currentView === 'trash') return;
    if (noteId === targetNoteId && Object.keys(updates).length === 0) {
      setDraggedNoteId(null);
      return;
    }

    const draggedNote = filteredNotes.find(note => note.id === noteId);
    if (!draggedNote) return;

    const orderedNotes = filteredNotes.filter(note => note.id !== noteId);
    const targetIndex = targetNoteId
      ? orderedNotes.findIndex(note => note.id === targetNoteId)
      : orderedNotes.length;
    const insertIndex = targetIndex >= 0 ? targetIndex : orderedNotes.length;

    orderedNotes.splice(insertIndex, 0, { ...draggedNote, ...updates });

    if (Object.keys(updates).length > 0) {
      await updateNote(noteId, updates);
    }
    await reorderNotes(orderedNotes.map(note => note.id));
    setSearchFilters({ sortBy: 'order', sortDir: 'asc' });
    setDraggedNoteId(null);
  };

  const beginSectionEdit = (sectionId: string, name: string) => {
    setEditingSectionId(sectionId);
    setEditingSectionName(name);
  };

  const cancelSectionEdit = () => {
    setEditingSectionId(null);
    setEditingSectionName('');
  };

  const saveSectionEdit = () => {
    if (!selectedNotebookId || !editingSectionId) return;
    const name = editingSectionName.trim();
    if (name) {
      updateSection(selectedNotebookId, editingSectionId, { name });
    }
    cancelSectionEdit();
  };

  const renderKanbanBoard = () => {
    if (currentView === 'notebooks' && selectedNotebookId) {
      const notebook = notebooks.find(nb => nb.id === selectedNotebookId);
      const sections = notebook?.sections || [];
      
      const columns = [
        { id: 'unassigned', name: 'Unassigned', sectionId: undefined as string | undefined, editable: false },
        ...sections.map(sec => ({ id: sec.id, name: sec.name, sectionId: sec.id, editable: true }))
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
                onDrop={e => void dropNoteAt(e, null, { sectionId: col.sectionId })}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3 pb-1 border-b theme-divider">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {editingSectionId === col.id ? (
                      <input
                        type="text"
                        value={editingSectionName}
                        onChange={e => setEditingSectionName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveSectionEdit();
                          if (e.key === 'Escape') cancelSectionEdit();
                        }}
                        onBlur={saveSectionEdit}
                        className="min-w-0 flex-1 bg-transparent text-xs font-bold uppercase tracking-wider text-theme-primary focus:outline-none"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => col.editable && beginSectionEdit(col.id, col.name)}
                        className={`min-w-0 text-left text-xs font-bold uppercase tracking-wider text-theme-secondary truncate ${col.editable ? 'hover:accent-text' : ''}`}
                      >
                        {col.name}
                      </button>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full accent-soft font-bold shrink-0">
                      {colNotes.length}
                    </span>
                  </div>
                  {col.editable && (
                    <div className="flex items-center gap-1">
                      {editingSectionId === col.id ? (
                        <>
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={saveSectionEdit}
                            className="p-1 rounded theme-hover text-theme-tertiary hover:accent-text cursor-pointer"
                            aria-label="Save section name"
                          >
                            <Check className="w-3.5 h-3.5 no-transition" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={cancelSectionEdit}
                            className="p-1 rounded theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                            aria-label="Cancel section edit"
                          >
                            <X className="w-3.5 h-3.5 no-transition" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => beginSectionEdit(col.id, col.name)}
                            className="p-1 rounded theme-hover text-theme-tertiary hover:accent-text cursor-pointer"
                            title="Rename section"
                          >
                            <Pencil className="w-3.5 h-3.5 no-transition" />
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete section "${col.name}"? Notes in this section will be unassigned.`)) {
                                void deleteSection(selectedNotebookId, col.id);
                              }
                            }}
                            className="p-1 rounded theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                            title="Delete section"
                          >
                            <Trash2 className="w-3.5 h-3.5 no-transition" />
                          </button>
                        </>
                      )}
                    </div>
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
                        onDragStart={e => beginNoteDrag(e, note.id)}
                        onDragEnd={() => setDraggedNoteId(null)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => void dropNoteAt(e, note.id, { sectionId: col.sectionId })}
                        className={`cursor-grab active:cursor-grabbing ${draggedNoteId === note.id ? 'opacity-50' : ''}`}
                      >
                        <div className="mb-1 flex items-center text-theme-muted" title="Drag note">
                          <GripVertical className="w-3.5 h-3.5 no-transition" />
                        </div>
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
      const priorityColumns: { id: string; name: string; priority: Priority | null }[] = [
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
                onDrop={e => void dropNoteAt(e, null, { priority: col.priority })}
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
                        onDragStart={e => beginNoteDrag(e, note.id)}
                        onDragEnd={() => setDraggedNoteId(null)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => void dropNoteAt(e, note.id, { priority: col.priority })}
                        className={`cursor-grab active:cursor-grabbing ${draggedNoteId === note.id ? 'opacity-50' : ''}`}
                      >
                        <div className="mb-1 flex items-center text-theme-muted" title="Drag note">
                          <GripVertical className="w-3.5 h-3.5 no-transition" />
                        </div>
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
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-theme-primary">{title}</h2>
            {activeNotebook && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowShareModal(true)}
                  className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer hover:text-[var(--accent-primary)] transition-colors"
                  title="Share this Notebook"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this notebook? All notes inside will be moved to the Trash.')) {
                      deleteNotebook(activeNotebook.id);
                    }
                  }}
                  className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer hover:text-red-500 transition-colors"
                  title="Delete this Notebook"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
            {bulkMode && (
              <span className="text-sm font-medium accent-text">
                {selectedIds.size} selected
              </span>
            )}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {!activeNotebook && !bulkMode && canCreateNoteHere && (
              <button
                onClick={handleCreateNoteHere}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg accent-button px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4 no-transition" />
                <span>New Note</span>
              </button>
            )}

            {onCollapsePanel && (
              <button
                type="button"
                onClick={onCollapsePanel}
                className="hidden xl:inline-flex p-2 rounded-lg theme-hover text-theme-tertiary"
                title="Collapse notes list"
                aria-label="Collapse notes list"
              >
                <PanelLeftClose className="w-4 h-4 no-transition" />
              </button>
            )}

            {/* Bulk mode toggle */}
            {filteredNotes.length > 0 && (
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
            {bulkMode && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectedIds.size === filteredNotes.length ? setSelectedIds(new Set()) : selectAll()}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: selectedIds.size === filteredNotes.length ? 'var(--active-bg)' : 'transparent',
                    color: selectedIds.size === filteredNotes.length ? 'var(--accent-primary)' : 'var(--text-secondary)'
                  }}
                >
                  {selectedIds.size === filteredNotes.length ? 'Deselect All' : 'Select All'}
                </button>
                {selectedIds.size > 0 && (
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
                    {currentView === 'trash' && (
                      <>
                        <div className="my-1 border-t theme-divider" />
                        <button
                          onClick={handleBulkRestore}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm theme-hover"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <CheckCircle2 className="w-4 h-4 no-transition" /> Restore
                        </button>
                        <button
                          onClick={handleBulkDelete}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-500/10"
                        >
                          <Trash2 className="w-4 h-4 no-transition" /> Delete Permanently
                        </button>
                      </>
                    )}

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
                <label
                  className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-lg border theme-border theme-input text-xs font-medium"
                  title="Sort notes"
                >
                  <ArrowUpDown className="w-4 h-4 no-transition shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                  <select
                    value={activeSortValue}
                    onChange={e => handleSortChange(e.target.value)}
                    className="bg-transparent text-theme-secondary focus:outline-none cursor-pointer"
                    aria-label="Sort notes"
                  >
                    {noteSortOptions.map(option => (
                      <option key={`${option.sortBy}:${option.sortDir}`} value={`${option.sortBy}:${option.sortDir}`}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

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

        {activeNotebook && canCreateNoteHere && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl border theme-border theme-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Current notebook</p>
              <p className="truncate text-sm font-semibold text-theme-primary">
                {activeNotebook.icon} {activeNotebook.name}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateNoteHere}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg accent-button px-4 py-2.5 text-sm font-semibold sm:w-auto"
              aria-label={`Create a new note in ${activeNotebook.name}`}
            >
              <Plus className="w-4 h-4 no-transition" />
              New note in this notebook
            </button>
          </div>
        )}

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

            {/* Shared By */}
            {sharedByOptions.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Shared by</p>
                <div className="flex gap-1.5 flex-wrap">
                  {sharedByOptions.map(email => (
                    <FilterChip
                      key={email}
                      label={email}
                      active={searchFilters.sharedBy?.includes(email) || false}
                      onClick={() => {
                        const current = searchFilters.sharedBy || [];
                        const next = current.includes(email)
                          ? current.filter(e => e !== email)
                          : [...current, email];
                        setSearchFilters({ sharedBy: next });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sort */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>Sort by</p>
              <div className="flex gap-1.5 flex-wrap">
                {noteSortOptions.map(option => (
                  <FilterChip
                    key={`${option.sortBy}:${option.sortDir}`}
                    label={option.label}
                    active={searchFilters.sortBy === option.sortBy && searchFilters.sortDir === option.sortDir}
                    onClick={() => setSearchFilters({ sortBy: option.sortBy, sortDir: option.sortDir })}
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
          {currentView === 'trash' && trashedNotebooks.length > 0 && (
            <div className="mb-8">
              <h3 className="text-sm font-bold uppercase tracking-wider text-theme-secondary mb-4">Trashed Notebooks</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {trashedNotebooks.map(nb => (
                  <div key={nb.id} className="p-4 rounded-xl border theme-divider bg-[var(--card-bg)] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{nb.icon}</span>
                      <span className="font-medium text-theme-primary">{nb.name}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => restoreNotebook(nb.id)}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium accent-soft accent-text hover:bg-[var(--accent-primary)] hover:text-white transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => permanentlyDeleteNotebook(nb.id)}
                        className="p-1.5 rounded-lg theme-hover text-theme-tertiary hover:text-red-500 transition-colors"
                        title="Delete Permanently"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              {filteredNotes.length > 0 && (
                <h3 className="text-sm font-bold uppercase tracking-wider text-theme-secondary mt-8 mb-4">Trashed Notes</h3>
              )}
            </div>
          )}

          {filteredNotes.length === 0 && trashedNotebooks.length === 0 ? (
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
            }
              onDragOver={e => {
                if (!bulkMode && currentView !== 'trash') e.preventDefault();
              }}
              onDrop={e => {
                if (!bulkMode && currentView !== 'trash') void dropNoteAt(e, null);
              }}
            >
              {filteredNotes.map(note => (
                <div 
                  key={note.id} 
                  draggable={!bulkMode && currentView !== 'trash'}
                  onDragStart={e => beginNoteDrag(e, note.id)}
                  onDragEnd={() => setDraggedNoteId(null)}
                  onDragOver={e => {
                    if (!bulkMode && currentView !== 'trash') e.preventDefault();
                  }}
                  onDrop={e => {
                    if (!bulkMode && currentView !== 'trash') void dropNoteAt(e, note.id);
                  }}
                  className={`relative cursor-pointer ${!bulkMode && currentView !== 'trash' ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedNoteId === note.id ? 'opacity-50' : ''}`}
                  onClickCapture={(e) => {
                    if (bulkMode) {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleSelect(note.id);
                    }
                  }}
                >
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
