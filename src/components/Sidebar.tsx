import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { useStore } from '@/store';
import {
  Home, FileText, Tag, Star, Archive, Trash2,
  Bell, Search, Settings, Plus, ChevronDown, ChevronRight,
  Moon, Sun, LayoutTemplate, LogOut, X, Share2,
  PanelLeftClose, PanelLeftOpen, GitBranch, FolderSearch,
  Edit3, GripVertical, ArrowUpDown
} from 'lucide-react';
import type { Notebook, NotebookSortBy, SidebarView, SortDirection } from '@/types';
import ManageNotebooksModal from './ManageNotebooksModal';
import { signOut } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import BrandMark from './BrandMark';

type NotebookDropPosition = 'before' | 'after' | 'inside';

interface NotebookDropTarget {
  parentId: string | null;
  index: number;
  targetId: string;
  position: NotebookDropPosition;
}

interface NotebookSortOption {
  label: string;
  sortBy: NotebookSortBy;
  sortDir: SortDirection;
}

const notebookSortOptions: NotebookSortOption[] = [
  { label: 'Manual order', sortBy: 'manual', sortDir: 'asc' },
  { label: 'Name A-Z', sortBy: 'name', sortDir: 'asc' },
  { label: 'Name Z-A', sortBy: 'name', sortDir: 'desc' },
  { label: 'Recently used', sortBy: 'recentNote', sortDir: 'desc' },
  { label: 'Least recently used', sortBy: 'recentNote', sortDir: 'asc' },
  { label: 'Newest created', sortBy: 'createdAt', sortDir: 'desc' },
  { label: 'Oldest created', sortBy: 'createdAt', sortDir: 'asc' },
  { label: 'Most notes', sortBy: 'noteCount', sortDir: 'desc' },
  { label: 'Fewest notes', sortBy: 'noteCount', sortDir: 'asc' },
];

const NOTEBOOK_EXPANSION_STORAGE_KEY = 'ntk-expanded-notebooks';

export default function Sidebar() {
  const {
    currentView, setCurrentView, profile, settings, setTheme,
    notebooks, tags, sidebarOpen, setSidebarOpen,
    createNotebook, selectNotebook, selectTag,
    notes, getStats, updateSettings, clearAuth, reorderNotebook, moveNote,
    selectedNotebookId, selectedTagId,
  } = useStore();

  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [showManageNotebooks, setShowManageNotebooks] = useState(false);
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editNotebookName, setEditNotebookName] = useState('');
  const [draggedNotebookId, setDraggedNotebookId] = useState<string | null>(null);
  const [notebookDropTarget, setNotebookDropTarget] = useState<NotebookDropTarget | null>(null);
  const [noteDropNotebookId, setNoteDropNotebookId] = useState<string | null>(null);
  const [hasStoredNotebookExpansion, setHasStoredNotebookExpansion] = useState(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(NOTEBOOK_EXPANSION_STORAGE_KEY) !== null
  ));
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = window.localStorage.getItem(NOTEBOOK_EXPANSION_STORAGE_KEY);
      if (!stored) return new Set();
      const ids = JSON.parse(stored);
      return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  });

  const stats = getStats();
  const trashedCount = notes.filter(n => n.trashed).length;
  const archivedCount = notes.filter(n => n.archived && !n.trashed).length;
  const starredCount = notes.filter(n => n.starred && !n.trashed && !n.archived).length;
  const remindersCount = notes.filter(n => n.reminder && !n.trashed).length;
  const collapsed = settings.sidebarCollapsed;
  const activeNotebookSortValue = `${settings.notebookSortBy}:${settings.notebookSortDir}`;
  const visibleNotebooks = useMemo(() => notebooks.filter(nb => !nb.trashed), [notebooks]);
  const parentNotebookIds = useMemo(() => new Set(
    visibleNotebooks
      .filter(parent => visibleNotebooks.some(child => child.parentId === parent.id))
      .map(nb => nb.id)
  ), [visibleNotebooks]);

  const getNotebookNoteCount = (notebookId: string) =>
    notes.filter(note => note.notebookId === notebookId && !note.trashed).length;

  const getNotebookRecentNoteTime = (notebookId: string) =>
    Math.max(
      0,
      ...notes
        .filter(note => note.notebookId === notebookId && !note.trashed)
        .map(note => new Date(note.updatedAt).getTime())
    );

  const sortNotebookItems = (items: Notebook[]) =>
    [...items].sort((a, b) => {
      let cmp = 0;
      if (settings.notebookSortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (settings.notebookSortBy === 'createdAt') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else if (settings.notebookSortBy === 'recentNote') {
        cmp = getNotebookRecentNoteTime(a.id) - getNotebookRecentNoteTime(b.id);
      } else if (settings.notebookSortBy === 'noteCount') {
        cmp = getNotebookNoteCount(a.id) - getNotebookNoteCount(b.id);
      } else {
        cmp = (a.order ?? 0) - (b.order ?? 0);
      }

      if (cmp === 0) {
        cmp =
          (a.order ?? 0) - (b.order ?? 0) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.name.localeCompare(b.name);
      }

      return settings.notebookSortDir === 'desc' ? -cmp : cmp;
    });

  const topLevelNotebooks = useMemo(
    () => sortNotebookItems(visibleNotebooks.filter(nb => !nb.parentId)),
    [visibleNotebooks, settings.notebookSortBy, settings.notebookSortDir, notes]
  );

  const navItems: { view: SidebarView; icon: typeof Home; label: string; badge?: number }[] = [
    { view: 'home', icon: Home, label: 'Home' },
    { view: 'all-notes', icon: FileText, label: 'All Notes', badge: stats.notes },
    { view: 'search', icon: Search, label: 'Search' },
    { view: 'starred', icon: Star, label: 'Starred', badge: starredCount || undefined },
    { view: 'reminders', icon: Bell, label: 'Reminders', badge: remindersCount || undefined },
    { view: 'shared', icon: Share2, label: 'Share Center' },
    { view: 'smart-folders', icon: FolderSearch, label: 'Smart Folders' },
    { view: 'graph', icon: GitBranch, label: 'Graph' },
    { view: 'templates', icon: LayoutTemplate, label: 'Templates' },
    { view: 'archived', icon: Archive, label: 'Archived', badge: archivedCount || undefined },
    { view: 'trash', icon: Trash2, label: 'Trash', badge: trashedCount || undefined },
  ];

  const handleCreateNotebook = () => {
    if (newNotebookName.trim()) {
      createNotebook(newNotebookName.trim());
      setNewNotebookName('');
      setShowNewNotebook(false);
    }
  };

  const handleSaveRenameNotebook = (id: string) => {
    if (editNotebookName.trim() && editNotebookName.trim() !== notebooks.find(nb => nb.id === id)?.name) {
      useStore.getState().updateNotebook(id, { name: editNotebookName.trim() });
    }
    setEditingNotebookId(null);
  };

  const getOrderedChildNotebooks = (parentId: string) =>
    sortNotebookItems(visibleNotebooks.filter(nb => nb.parentId === parentId));

  const updateExpandedNotebookIds = (updater: (previous: Set<string>) => Set<string>) => {
    setExpandedNotebookIds(previous => {
      const next = updater(new Set(previous));
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(NOTEBOOK_EXPANSION_STORAGE_KEY, JSON.stringify([...next]));
      }
      return next;
    });
    setHasStoredNotebookExpansion(true);
  };

  const expandNotebook = (notebookId: string) => {
    updateExpandedNotebookIds(previous => {
      previous.add(notebookId);
      return previous;
    });
  };

  const toggleNotebookExpanded = (notebookId: string) => {
    updateExpandedNotebookIds(previous => {
      if (previous.has(notebookId)) {
        previous.delete(notebookId);
      } else {
        previous.add(notebookId);
      }
      return previous;
    });
  };

  useEffect(() => {
    if (hasStoredNotebookExpansion || parentNotebookIds.size === 0) return;
    setExpandedNotebookIds(previous => {
      const next = new Set(previous);
      parentNotebookIds.forEach(id => next.add(id));
      return next;
    });
  }, [hasStoredNotebookExpansion, parentNotebookIds]);

  useEffect(() => {
    if (!selectedNotebookId) return;
    const ancestorIds: string[] = [];
    let parentId = notebooks.find(nb => nb.id === selectedNotebookId)?.parentId ?? null;
    while (parentId) {
      ancestorIds.push(parentId);
      parentId = notebooks.find(nb => nb.id === parentId)?.parentId ?? null;
    }
    if (ancestorIds.length === 0) return;

    setExpandedNotebookIds(previous => {
      const next = new Set(previous);
      let changed = false;
      ancestorIds.forEach(id => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [notebooks, selectedNotebookId]);

  const isNotebookDescendant = (candidateParentId: string | null, notebookId: string) => {
    let currentId = candidateParentId;
    while (currentId) {
      if (currentId === notebookId) return true;
      currentId = notebooks.find(nb => nb.id === currentId)?.parentId ?? null;
    }
    return false;
  };

  const canDropNotebook = (notebookId: string | null, parentId: string | null) => {
    if (!notebookId) return false;
    if (notebookId === parentId) return false;
    if (notebookId === 'default' && parentId !== null) return false;
    return !isNotebookDescendant(parentId, notebookId);
  };

  const handleNotebookDragStart = (event: DragEvent<HTMLElement>, notebook: Notebook) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', notebook.id);
    setDraggedNotebookId(notebook.id);
  };

  const clearNotebookDrag = () => {
    setDraggedNotebookId(null);
    setNotebookDropTarget(null);
    setNoteDropNotebookId(null);
  };

  const isNoteDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes('application/x-ntk-note-id');

  const getDraggedNoteId = (event: DragEvent<HTMLElement>) =>
    event.dataTransfer.getData('application/x-ntk-note-id');

  const handleNotebookRowDragOver = (
    event: DragEvent<HTMLElement>,
    targetNotebook: Notebook,
    rowParentId: string | null,
    targetIndex: number,
    allowInside: boolean
  ) => {
    if (isNoteDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setNotebookDropTarget(null);
      setNoteDropNotebookId(targetNotebook.id);
      return;
    }

    handleNotebookDragOver(event, targetNotebook, rowParentId, targetIndex, allowInside);
  };

  const handleNotebookRowDrop = (event: DragEvent<HTMLElement>, targetNotebook: Notebook) => {
    const noteId = getDraggedNoteId(event);
    if (noteId) {
      event.preventDefault();
      event.stopPropagation();
      const note = notes.find(item => item.id === noteId && !item.trashed);
      if (note && note.notebookId !== targetNotebook.id) {
        void moveNote(note.id, targetNotebook.id);
      }
      setNoteDropNotebookId(null);
      return;
    }

    handleNotebookDrop(event);
  };

  const handleNotebookRowDragLeave = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (noteDropNotebookId !== targetId) return;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setNoteDropNotebookId(null);
  };

  const handleNotebookDragOver = (
    event: DragEvent<HTMLElement>,
    targetNotebook: Notebook,
    rowParentId: string | null,
    targetIndex: number,
    allowInside: boolean
  ) => {
    const dragId = draggedNotebookId || event.dataTransfer.getData('text/plain');
    if (!dragId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const yRatio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    let position: NotebookDropPosition;
    let parentId = rowParentId;
    let index = targetIndex;

    if (allowInside && yRatio > 0.28 && yRatio < 0.72) {
      position = 'inside';
      parentId = targetNotebook.id;
      index = getOrderedChildNotebooks(targetNotebook.id).length;
    } else {
      position = yRatio < 0.5 ? 'before' : 'after';
      index = position === 'before' ? targetIndex : targetIndex + 1;
    }

    if (!canDropNotebook(dragId, parentId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setNotebookDropTarget({ parentId, index, targetId: targetNotebook.id, position });
  };

  const handleNotebookDrop = (event: DragEvent<HTMLElement>) => {
    const dragId = draggedNotebookId || event.dataTransfer.getData('text/plain');
    if (!dragId || !notebookDropTarget) return;

    event.preventDefault();
    reorderNotebook(dragId, notebookDropTarget.parentId, notebookDropTarget.index);
    if (notebookDropTarget.position === 'inside' && notebookDropTarget.parentId) {
      expandNotebook(notebookDropTarget.parentId);
    }
    updateSettings({ notebookSortBy: 'manual', notebookSortDir: 'asc' });
    clearNotebookDrag();
  };

  const getNotebookDropStyle = (targetId: string): CSSProperties => {
    if (noteDropNotebookId === targetId) {
      return {
        backgroundColor: 'var(--active-bg)',
        outline: '1px solid var(--accent-primary)',
        boxShadow: '0 0 0 3px var(--accent-glow)',
      };
    }
    if (notebookDropTarget?.targetId !== targetId) return {};
    if (notebookDropTarget.position === 'before') {
      return { boxShadow: 'inset 0 2px 0 var(--accent-primary)' };
    }
    if (notebookDropTarget.position === 'after') {
      return { boxShadow: 'inset 0 -2px 0 var(--accent-primary)' };
    }
    return { backgroundColor: 'var(--active-bg)', outline: '1px solid var(--accent-primary)' };
  };

  const handleNavClick = (view: SidebarView) => {
    setCurrentView(view);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await signOut(auth).catch(console.error);
    clearAuth();
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:relative z-50 h-full flex flex-col w-72
          ${collapsed ? 'lg:w-20' : 'lg:w-72'}
          theme-sidebar
          border-r transition-[width,transform] duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border)',
        }}
      >
        {/* Header */}
        <div className={`relative flex items-center justify-between p-4 theme-divider border-b ${collapsed ? 'lg:justify-center lg:px-3' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center' : ''}`}>
            <BrandMark className="w-9 h-9" />
            <div className={collapsed ? 'lg:hidden' : ''}>
              <h1 className="text-base font-bold text-theme-primary">NTK Note</h1>
              <p className="text-xs text-theme-tertiary truncate max-w-[140px]">{profile.email || profile.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateSettings({ sidebarCollapsed: !collapsed })}
            className={`hidden lg:inline-flex p-1.5 rounded-lg theme-hover text-theme-tertiary ${collapsed ? 'lg:absolute lg:right-2 lg:top-4' : ''}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-5 h-5 no-transition" /> : <PanelLeftClose className="w-5 h-5 no-transition" />}
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg theme-hover text-theme-tertiary"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {/* Main nav */}
          <div className="space-y-0.5">
            {navItems.map(item => (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                  ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                  ${currentView === item.view
                    ? 'theme-active'
                    : 'text-theme-secondary theme-hover'
                  }
                `}
                style={currentView === item.view ? { backgroundColor: 'var(--active-bg)' } : {}}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0 no-transition" />
                <span className={`flex-1 text-left ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${collapsed ? 'lg:hidden' : ''}`}
                    style={{
                      backgroundColor: currentView === item.view ? 'var(--accent-glow)' : 'var(--input-bg)',
                      color: currentView === item.view ? 'var(--badge-text)' : 'var(--text-tertiary)',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Notebooks */}
          <div className={`mt-4 pt-4 border-t theme-divider ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="flex items-center px-3 py-2 text-xs font-semibold text-theme-tertiary uppercase tracking-wider">
              <button
                type="button"
                onClick={() => setNotebooksExpanded(!notebooksExpanded)}
                className="flex flex-1 items-center justify-between"
              >
                <span>Notebooks</span>
                {notebooksExpanded ? <ChevronDown className="w-3.5 h-3.5 no-transition" /> : <ChevronRight className="w-3.5 h-3.5 no-transition" />}
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowManageNotebooks(true)}
                  className="p-0.5 rounded theme-hover"
                  title="Manage notebooks"
                  aria-label="Manage notebooks"
                >
                  <Settings className="w-3.5 h-3.5 no-transition" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewNotebook(!showNewNotebook)}
                  className="p-0.5 rounded theme-hover"
                  title="New notebook"
                  aria-label="New notebook"
                >
                  <Plus className="w-3.5 h-3.5 no-transition" />
                </button>
              </div>
            </div>

            {notebooksExpanded && (
              <div className="px-3 pb-2">
                <label
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border theme-border theme-input text-xs"
                  title="Sort notebooks"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 no-transition shrink-0 text-theme-tertiary" />
                  <select
                    value={activeNotebookSortValue}
                    onChange={e => {
                      const option = notebookSortOptions.find(item => `${item.sortBy}:${item.sortDir}` === e.target.value);
                      if (option) {
                        updateSettings({ notebookSortBy: option.sortBy, notebookSortDir: option.sortDir });
                      }
                    }}
                    className="w-full min-w-0 bg-transparent text-theme-secondary focus:outline-none cursor-pointer"
                    aria-label="Sort notebooks"
                  >
                    {notebookSortOptions.map(option => (
                      <option key={`${option.sortBy}:${option.sortDir}`} value={`${option.sortBy}:${option.sortDir}`}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {showNewNotebook && (
              <div className="px-3 pb-2">
                <input
                  type="text"
                  value={newNotebookName}
                  onChange={e => setNewNotebookName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateNotebook()}
                  onBlur={() => { if (!newNotebookName.trim()) setShowNewNotebook(false); }}
                  placeholder="New notebook name..."
                  className="w-full px-3 py-1.5 text-sm rounded-lg theme-input accent-focus focus:outline-none"
                  autoFocus
                />
              </div>
            )}

            {notebooksExpanded && (
              <div className="space-y-0.5">
                {topLevelNotebooks.map((nb, notebookIndex) => {
                  const childNotebooks = getOrderedChildNotebooks(nb.id);
                  const hasChildren = childNotebooks.length > 0;
                  const isExpanded = expandedNotebookIds.has(nb.id);
                  const noteCount = notes.filter(n => n.notebookId === nb.id && !n.trashed).length;
                  const isSelected = currentView === 'notebooks' && selectedNotebookId === nb.id;
                  
                  return (
                    <div key={nb.id} className="group">
                      <div
                        className="flex items-center rounded-xl"
                        onDragOver={(e) => handleNotebookRowDragOver(e, nb, null, notebookIndex, true)}
                        onDrop={(e) => handleNotebookRowDrop(e, nb)}
                        onDragLeave={(e) => handleNotebookRowDragLeave(e, nb.id)}
                        style={getNotebookDropStyle(nb.id)}
                      >
                        {editingNotebookId === nb.id ? (
                          <div className="flex-1 px-3 py-1">
                            <input
                              type="text"
                              value={editNotebookName}
                              onChange={e => setEditNotebookName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveRenameNotebook(nb.id);
                                if (e.key === 'Escape') setEditingNotebookId(null);
                              }}
                              onBlur={() => handleSaveRenameNotebook(nb.id)}
                              className="w-full px-2 py-0.5 text-xs rounded border theme-input focus:outline-none accent-focus"
                              autoFocus
                              onFocus={e => e.target.select()}
                            />
                          </div>
                        ) : (
                          <>
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleNotebookExpanded(nb.id);
                                }}
                                className="ml-1 p-1 rounded theme-hover text-theme-tertiary transition-all"
                                title={isExpanded ? 'Collapse sub-notebooks' : 'Expand sub-notebooks'}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${nb.name}`}
                                aria-expanded={isExpanded}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 no-transition" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 no-transition" />
                                )}
                              </button>
                            ) : (
                              <span className="ml-1 w-[22px] shrink-0" aria-hidden="true" />
                            )}
                            <button
                              type="button"
                              draggable
                              onDragStart={(e) => handleNotebookDragStart(e, nb)}
                              onDragEnd={clearNotebookDrag}
                              onClick={(e) => e.stopPropagation()}
                              className={`p-1 rounded theme-hover text-theme-tertiary cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all ${
                                draggedNotebookId === nb.id ? 'opacity-100' : ''
                              }`}
                              title="Drag notebook"
                              aria-label={`Drag ${nb.name}`}
                            >
                              <GripVertical className="w-3.5 h-3.5 no-transition" />
                            </button>
                            <button
                              onClick={() => { selectNotebook(nb.id); handleNavClick('notebooks'); }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (nb.id === 'default') return;
                                setEditingNotebookId(nb.id);
                                setEditNotebookName(nb.name);
                              }}
                              className={`
                                flex-1 flex items-center gap-3 px-2 py-2 rounded-xl text-sm transition-all
                                ${isSelected
                                  ? 'font-medium'
                                  : 'text-theme-secondary theme-hover'
                                }
                              `}
                              style={isSelected ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
                            >
                              <span className="text-base">{nb.icon}</span>
                              <span className="flex-1 text-left truncate">{nb.name}</span>
                              <span className="text-xs text-theme-tertiary">{noteCount}</span>
                            </button>
                            {/* Explicit rename button */}
                            {nb.id !== 'default' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNotebookId(nb.id);
                                  setEditNotebookName(nb.name);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded theme-hover text-theme-tertiary transition-all"
                                title="Rename notebook"
                              >
                                <Edit3 className="w-3 h-3 no-transition" />
                              </button>
                            )}
                            {/* Add sub-notebook button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const name = prompt('Sub-notebook name:');
                                if (name?.trim()) {
                                  createNotebook(name.trim(), nb.id, '\uD83D\uDCC1');
                                  expandNotebook(nb.id);
                                  setNotebooksExpanded(true);
                                }
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded theme-hover text-theme-tertiary transition-all"
                              title="Add sub-notebook"
                            >
                              <Plus className="w-3 h-3 no-transition" />
                            </button>
                          </>
                        )}
                      </div>
                      {/* Sub-notebooks */}
                      {hasChildren && isExpanded && childNotebooks.map((sub, subIndex) => {
                        const subSelected = currentView === 'notebooks' && selectedNotebookId === sub.id;
                        const subCount = notes.filter(n => n.notebookId === sub.id && !n.trashed).length;
                        return (
                          <div
                            key={sub.id}
                            className="group/sub flex items-center rounded-xl"
                            onDragOver={(e) => handleNotebookRowDragOver(e, sub, nb.id, subIndex, false)}
                            onDrop={(e) => handleNotebookRowDrop(e, sub)}
                            onDragLeave={(e) => handleNotebookRowDragLeave(e, sub.id)}
                            style={getNotebookDropStyle(sub.id)}
                          >
                            {editingNotebookId === sub.id ? (
                              <div className="flex-1 pl-9 pr-3 py-1">
                                <input
                                  type="text"
                                  value={editNotebookName}
                                  onChange={e => setEditNotebookName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveRenameNotebook(sub.id);
                                    if (e.key === 'Escape') setEditingNotebookId(null);
                                  }}
                                  onBlur={() => handleSaveRenameNotebook(sub.id)}
                                  className="w-full px-2 py-0.5 text-xs rounded border theme-input focus:outline-none accent-focus"
                                  autoFocus
                                  onFocus={e => e.target.select()}
                                />
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(e) => handleNotebookDragStart(e, sub)}
                                  onDragEnd={clearNotebookDrag}
                                  onClick={(e) => e.stopPropagation()}
                                  className={`ml-6 p-1 rounded theme-hover text-theme-tertiary cursor-grab active:cursor-grabbing opacity-0 group-hover/sub:opacity-100 focus:opacity-100 transition-all ${
                                    draggedNotebookId === sub.id ? 'opacity-100' : ''
                                  }`}
                                  title="Drag notebook"
                                  aria-label={`Drag ${sub.name}`}
                                >
                                  <GripVertical className="w-3 h-3 no-transition" />
                                </button>
                                <button
                                  onClick={() => { selectNotebook(sub.id); handleNavClick('notebooks'); }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditingNotebookId(sub.id);
                                    setEditNotebookName(sub.name);
                                  }}
                                  className={`
                                    flex-1 flex items-center gap-2 px-2 py-1.5 rounded-xl text-sm transition-all
                                    ${subSelected
                                      ? 'font-medium'
                                      : 'text-theme-tertiary theme-hover'
                                    }
                                  `}
                                  style={subSelected ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
                                >
                                  <span className="text-sm">{sub.icon}</span>
                                  <span className="flex-1 text-left truncate">{sub.name}</span>
                                  <span className="text-xs text-theme-tertiary">{subCount}</span>
                                </button>
                                {/* Explicit rename button */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingNotebookId(sub.id);
                                    setEditNotebookName(sub.name);
                                  }}
                                  className="opacity-0 group-hover/sub:opacity-100 p-1 mr-1 rounded theme-hover text-theme-tertiary transition-all"
                                  title="Rename notebook"
                                >
                                  <Edit3 className="w-3 h-3 no-transition" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className={`mt-4 pt-4 border-t theme-divider ${collapsed ? 'lg:hidden' : ''}`}>
            <button
              onClick={() => setTagsExpanded(!tagsExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-theme-tertiary uppercase tracking-wider"
            >
              <span>Tags</span>
              {tagsExpanded ? <ChevronDown className="w-3.5 h-3.5 no-transition" /> : <ChevronRight className="w-3.5 h-3.5 no-transition" />}
            </button>
            {tagsExpanded && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {tags.length === 0 && (
                  <p className="text-xs text-theme-tertiary py-1">No tags yet</p>
                )}
                {tags.map(tag => {
                  const isActive = currentView === 'tags' && selectedTagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => { selectTag(tag.id); handleNavClick('tags'); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                      style={{
                        backgroundColor: isActive ? 'var(--active-bg)' : 'var(--input-bg)',
                        color: isActive ? 'var(--badge-text)' : 'var(--text-secondary)',
                      }}
                    >
                      <Tag className="w-3 h-3 no-transition" />
                      {tag.name}
                      <span className="text-theme-tertiary">({tag.count})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className={`p-3 border-t theme-divider space-y-1 ${collapsed ? 'lg:px-2' : ''}`}>
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-theme-secondary theme-hover transition-all group ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
            title={settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            aria-label={settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          >
            {settings.theme === 'light' ? (
              <Moon className="w-[18px] h-[18px] no-transition" />
            ) : (
              <Sun className="w-[18px] h-[18px] no-transition group-hover:text-amber-400" />
            )}
            <span className={`font-medium ${collapsed ? 'lg:hidden' : ''}`}>{settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => handleNavClick('settings')}
            title="Settings"
            aria-label="Settings"
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all
              ${collapsed ? 'lg:justify-center lg:px-0' : ''}
              ${currentView === 'settings'
                ? 'font-medium'
                : 'text-theme-secondary theme-hover'
              }
            `}
            style={currentView === 'settings' ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
          >
            <Settings className="w-[18px] h-[18px] no-transition" />
            <span className={collapsed ? 'lg:hidden' : ''}>Settings</span>
          </button>

          {/* User profile */}
          <div className={`flex items-center gap-3 px-3 py-2 mt-1 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <div className="w-8 h-8 rounded-full accent-gradient flex items-center justify-center text-white text-xs font-bold shadow-lg">
              {profile.initials}
            </div>
            <div className={`flex-1 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="text-sm font-medium text-theme-primary truncate">{profile.name}</p>
              <p className="text-xs text-theme-tertiary truncate">{profile.email || 'Free Plan'}</p>
            </div>
            <button
              onClick={handleLogout}
              className={`p-1.5 rounded-lg theme-hover text-theme-tertiary ${collapsed ? 'lg:hidden' : ''}`}
              title="Log out"
            >
              <LogOut className="w-4 h-4 no-transition" />
            </button>
          </div>
        </div>
      </aside>
      <ManageNotebooksModal isOpen={showManageNotebooks} onClose={() => setShowManageNotebooks(false)} />
    </>
  );
}
