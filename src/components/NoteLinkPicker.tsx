import { useState } from 'react';
import { useStore } from '@/store';
import { Search, Link2, FileText, CheckSquare, Code, X } from 'lucide-react';

interface Props {
  onSelect: (noteId: string, noteTitle: string) => void;
  onClose: () => void;
  excludeId?: string;
}

export default function NoteLinkPicker({ onSelect, onClose, excludeId }: Props) {
  const { notes } = useStore();
  const [query, setQuery] = useState('');

  const filteredNotes = notes
    .filter(n => !n.trashed && n.id !== excludeId)
    .filter(n => 
      n.title.toLowerCase().includes(query.toLowerCase()) ||
      n.content.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, 10);

  const getIcon = (type: string) => {
    if (type === 'checklist') return CheckSquare;
    if (type === 'markdown') return Code;
    return FileText;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md theme-card rounded-2xl border overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-theme-primary">Link to Note</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg theme-hover text-theme-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b theme-divider">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-tertiary" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search notes to link..."
              className="w-full pl-9 pr-4 py-2 rounded-lg theme-input text-sm border-0 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <p className="text-center text-theme-tertiary text-sm py-8">No notes found</p>
          ) : (
            filteredNotes.map(note => {
              const Icon = getIcon(note.type);
              return (
                <button
                  key={note.id}
                  onClick={() => onSelect(note.id, note.title || 'Untitled')}
                  className="w-full flex items-center gap-3 px-4 py-3 theme-hover transition-colors text-left"
                >
                  <Icon className="w-4 h-4 text-theme-tertiary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-theme-primary truncate">
                      {note.title || 'Untitled'}
                    </p>
                    <p className="text-xs text-theme-tertiary truncate">
                      {note.content.slice(0, 60) || 'No content'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
