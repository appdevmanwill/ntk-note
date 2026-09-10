import { useState, useRef, useEffect } from 'react';
import { X, Book, Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import type { NoteColor } from '@/types';

interface NewNotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const colorOptions: Array<{ id: NoteColor; bg: string; label: string }> = [
  { id: 'indigo', bg: 'bg-indigo-500', label: 'Indigo' },
  { id: 'blue', bg: 'bg-blue-500', label: 'Blue' },
  { id: 'teal', bg: 'bg-teal-500', label: 'Teal' },
  { id: 'green', bg: 'bg-emerald-500', label: 'Green' },
  { id: 'yellow', bg: 'bg-amber-500', label: 'Amber' },
  { id: 'orange', bg: 'bg-orange-500', label: 'Orange' },
  { id: 'red', bg: 'bg-rose-500', label: 'Rose' },
  { id: 'purple', bg: 'bg-purple-500', label: 'Purple' },
];

export default function NewNotebookModal({ isOpen, onClose }: NewNotebookModalProps) {
  const { createNotebook, updateNotebook, selectNotebook, setCurrentView } = useStore();
  const [name, setName] = useState('');
  const [color, setColor] = useState<NoteColor>('indigo');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setColor('indigo');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a name for the notebook.');
      return;
    }

    const nb = createNotebook(trimmed, null, '📓');
    if (color && color !== 'default') {
      updateNotebook(nb.id, { color });
    }
    selectNotebook(nb.id);
    setCurrentView('all-notes');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-notebook-title"
    >
      <div className="w-full max-w-md rounded-t-3xl border theme-border theme-card p-6 shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Book className="h-5 w-5 no-transition" />
            </span>
            <div>
              <h2 id="new-notebook-title" className="text-base font-bold text-theme-primary">New Notebook</h2>
              <p className="text-xs text-theme-tertiary">Group your notes into a dedicated notebook</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-theme-tertiary theme-hover"
            aria-label="Close"
          >
            <X className="h-5 w-5 no-transition" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="notebook-name-input" className="block text-xs font-semibold text-theme-secondary mb-1.5">
              Notebook name
            </label>
            <input
              ref={inputRef}
              id="notebook-name-input"
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); if (error) setError(''); }}
              placeholder="e.g. Work, Ideas, Meeting Notes"
              className="w-full rounded-xl border theme-border theme-input px-3.5 py-2.5 text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              maxLength={80}
            />
            {error && <p className="mt-1.5 text-xs text-rose-500 font-medium">{error}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-theme-secondary mb-1.5">
              Color tag (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setColor(opt.id)}
                  title={opt.label}
                  aria-label={opt.label}
                  className={`h-7 w-7 rounded-full transition-transform ${opt.bg} ${
                    color === opt.id ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : 'opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border theme-border px-4 py-2 text-xs font-semibold text-theme-secondary theme-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl accent-button px-4 py-2 text-xs font-semibold text-white shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5 no-transition" />
              Create Notebook
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
