import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import { ChevronDown, ChevronRight, FileText, Plus, Search, Pencil } from 'lucide-react';
import NewNotebookModal from './NewNotebookModal';
import type { Notebook } from '@/types';

/**
 * Phone-friendly notebook browser. Lists notebooks with live note counts;
 * tapping a notebook opens it in the notes view.
 */
export default function FoldersView() {
  const {
    notebooks, notes, selectNotebook, setCurrentView,
    selectedNotebookId, currentView,
  } = useStore();
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalParentId, setModalParentId] = useState<string | null>(null);
  const [modalEditId, setModalEditId] = useState<string | null>(null);

  const openNotebookModal = (parentId: string | null = null, editId: string | null = null) => {
    setModalParentId(parentId);
    setModalEditId(editId);
    setModalOpen(true);
    if (parentId) setExpandedIds(prev => new Set([...prev, parentId]));
  };
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const visible = useMemo(() => notebooks.filter(nb => !nb.trashed), [notebooks]);

  const countFor = (id: string) =>
    notes.filter(n => n.notebookId === id && !n.trashed).length;

  const topLevel = useMemo(
    () => visible.filter(nb => !nb.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [visible]
  );

  const childrenOf = (parentId: string) =>
    visible.filter(nb => nb.parentId === parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const matches = (nb: Notebook) => nb.name.toLowerCase().includes(query.trim().toLowerCase());

  const openNotebook = (id: string) => {
    selectNotebook(id);
    setCurrentView('notebooks');
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderRow = (nb: Notebook, depth = 0) => {
    const children = childrenOf(nb.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(nb.id);
    const isSelected = currentView === 'notebooks' && selectedNotebookId === nb.id;

    return (
      <div key={nb.id}>
        <div
          className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 transition-colors ${
            isSelected ? 'theme-active' : 'theme-card theme-hover'
          }`}
          style={{ marginLeft: depth * 16 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(nb.id)}
              className="p-1 rounded-lg theme-hover text-theme-tertiary"
              aria-label={isExpanded ? `Collapse ${nb.name}` : `Expand ${nb.name}`}
              aria-expanded={isExpanded}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-6" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => openNotebook(nb.id)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-lg">
              {nb.icon || '📓'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-theme-primary">{nb.name}</span>
              <span className="block text-xs text-theme-tertiary">
                {countFor(nb.id)} item{countFor(nb.id) === 1 ? '' : 's'}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted" aria-hidden="true" />
          </button>
          {nb.id !== 'default' && (
            <button type="button" className="p-2 rounded-lg theme-hover text-theme-secondary" onClick={() => openNotebookModal(null, nb.id)}
              aria-label={`Edit ${nb.name} icon and name`} title="Edit notebook">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button type="button" className="p-2 rounded-lg theme-hover text-theme-secondary" onClick={() => openNotebookModal(nb.id)}
            aria-label={`Add sub-notebook under ${nb.name}`} title="Add sub-notebook">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {hasChildren && isExpanded && children.map(child => renderRow(child, depth + 1))}
      </div>
    );
  };

  const filteredTopLevel = topLevel.filter(nb => matches(nb) || childrenOf(nb.id).some(matches) || expandedIds.has(nb.id));

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto max-w-2xl p-4 pb-28 lg:pb-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-theme-primary">Folders</h1>
          <button type="button" onClick={() => openNotebookModal()} className="flex h-10 items-center gap-1 rounded-xl px-3 accent-button text-sm font-semibold"
            aria-label="Create notebook"><Plus className="h-4 w-4" /> New</button>
          <button
            type="button"
            onClick={() => setCurrentView('all-notes')}
            className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-secondary"
            aria-label="View all notes"
            title="View all notes"
          >
            <FileText className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-4 flex items-center gap-2 rounded-xl border theme-border px-3.5 py-2.5" style={{ backgroundColor: 'var(--input-bg)' }}>
          <Search className="h-4 w-4 shrink-0 text-theme-tertiary" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search folders..."
            aria-label="Search folders"
            className="w-full bg-transparent text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none"
          />
        </label>

        {filteredTopLevel.length === 0 ? (
          <div className="rounded-2xl border theme-border p-8 text-center" style={{ backgroundColor: 'var(--input-bg)' }}>
            <p className="text-sm font-medium text-theme-secondary">No folders found</p>
            <p className="mt-1 text-xs text-theme-tertiary">Create one from the desktop sidebar or the Manage notebooks panel.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTopLevel.map(nb => renderRow(nb))}
          </div>
        )}

        <button
          type="button"
          onClick={() => setCurrentView('all-notes')}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed theme-border px-4 py-3.5 text-sm font-medium text-theme-tertiary theme-hover"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Browse all notes
        </button>
      </div>
      <NewNotebookModal isOpen={modalOpen} parentId={modalParentId} editingNotebookId={modalEditId} onClose={() => setModalOpen(false)} />
    </div>
  );
}
