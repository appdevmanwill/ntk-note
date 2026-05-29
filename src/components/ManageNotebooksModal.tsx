import { useState } from 'react';
import { useStore } from '@/store';
import { X, Trash2, CheckCircle2 } from 'lucide-react';

interface ManageNotebooksModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ManageNotebooksModal({ isOpen, onClose }: ManageNotebooksModalProps) {
  const { notebooks, deleteNotebook } = useStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const manageableNotebooks = notebooks.filter(nb => nb.id !== 'default' && !nb.trashed);

  if (!isOpen) return null;

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
    if (selectedIds.size === manageableNotebooks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(manageableNotebooks.map(nb => nb.id)));
    }
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Are you sure you want to delete ${selectedIds.size} notebook(s)? All notes inside these notebooks will be moved to the Trash.`)) {
      selectedIds.forEach(id => deleteNotebook(id));
      setSelectedIds(new Set());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--theme-divider)' }}>
        {/* Header */}
        <div className="flex flex-col p-6 pb-4 border-b theme-divider relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full theme-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X className="w-5 h-5 no-transition" />
          </button>
          
          <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Manage Notebooks</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Select notebooks to delete in bulk.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 max-h-[60vh]">
          {manageableNotebooks.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>No notebooks found.</p>
          ) : (
            <div className="space-y-2">
              <button
                onClick={selectAll}
                className="w-full flex items-center gap-3 p-3 rounded-xl border transition-colors theme-hover"
                style={{
                  backgroundColor: selectedIds.size === manageableNotebooks.length ? 'var(--active-bg)' : 'transparent',
                  borderColor: selectedIds.size === manageableNotebooks.length ? 'var(--accent-primary)' : 'var(--theme-divider)'
                }}
              >
                <div 
                  className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                    selectedIds.size === manageableNotebooks.length ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'border-[var(--text-muted)]'
                  }`}
                >
                  {selectedIds.size === manageableNotebooks.length && <CheckCircle2 className="w-3.5 h-3.5 text-white no-transition" />}
                </div>
                <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
                  {selectedIds.size === manageableNotebooks.length ? 'Deselect All' : 'Select All'}
                </span>
              </button>
              
              <div className="my-2 border-t theme-divider" />

              {manageableNotebooks.map(nb => (
                <button
                  key={nb.id}
                  onClick={() => toggleSelect(nb.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border transition-colors theme-hover"
                  style={{
                    backgroundColor: selectedIds.has(nb.id) ? 'var(--active-bg)' : 'transparent',
                    borderColor: selectedIds.has(nb.id) ? 'var(--accent-primary)' : 'var(--theme-divider)'
                  }}
                >
                  <div 
                    className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                      selectedIds.has(nb.id) ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'border-[var(--text-muted)]'
                    }`}
                  >
                    {selectedIds.has(nb.id) && <CheckCircle2 className="w-3.5 h-3.5 text-white no-transition" />}
                  </div>
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{nb.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t theme-divider bg-black/5 flex justify-between items-center">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {selectedIds.size} selected
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-colors theme-hover"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-500 hover:bg-red-600"
            >
              <Trash2 className="w-4 h-4 no-transition" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
