import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { History, X, RotateCcw, Clock, Eye, ChevronRight } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface NoteVersion {
  id: string;
  noteId: string;
  title: string;
  content: string;
  timestamp: string;
}

interface Props {
  noteId: string;
  onClose: () => void;
  onRestore: (version: NoteVersion) => void;
}

// Store versions in localStorage
const getVersions = (noteId: string): NoteVersion[] => {
  try {
    const raw = localStorage.getItem(`ntk-versions-${noteId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveVersion = (version: NoteVersion) => {
  const versions = getVersions(version.noteId);
  // Keep last 50 versions per note
  const newVersions = [version, ...versions].slice(0, 50);
  localStorage.setItem(`ntk-versions-${version.noteId}`, JSON.stringify(newVersions));
};

// Hook to automatically save versions
export const useVersionHistory = (noteId: string | null, title: string, content: string) => {
  useEffect(() => {
    if (!noteId || (!title && !content)) return;

    // Debounce: save version every 30 seconds of inactivity
    const timer = setTimeout(() => {
      const versions = getVersions(noteId);
      const lastVersion = versions[0];
      
      // Only save if content changed
      if (!lastVersion || lastVersion.title !== title || lastVersion.content !== content) {
        saveVersion({
          id: Date.now().toString(),
          noteId,
          title,
          content,
          timestamp: new Date().toISOString(),
        });
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [noteId, title, content]);
};

export default function VersionHistory({ noteId, onClose, onRestore }: Props) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<NoteVersion | null>(null);
  const { getNoteById } = useStore();
  
  const currentNote = getNoteById(noteId);

  useEffect(() => {
    setVersions(getVersions(noteId));
  }, [noteId]);

  const handleRestore = (version: NoteVersion) => {
    if (confirm('Restore this version? Current content will be saved as a new version.')) {
      // Save current state first
      if (currentNote) {
        saveVersion({
          id: Date.now().toString(),
          noteId,
          title: currentNote.title,
          content: currentNote.content,
          timestamp: new Date().toISOString(),
        });
      }
      onRestore(version);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[80vh] theme-card rounded-2xl border overflow-hidden animate-scale-in flex">
        {/* Versions list */}
        <div className="w-72 border-r theme-divider flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-500" />
              <h3 className="font-semibold text-theme-primary">Version History</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg theme-hover text-theme-tertiary lg:hidden">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Current version */}
            <div
              onClick={() => setSelectedVersion(null)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b theme-divider ${
                !selectedVersion ? 'theme-active' : 'theme-hover'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center">
                <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-theme-primary">Current version</p>
                <p className="text-xs text-theme-tertiary">Now</p>
              </div>
            </div>

            {/* Previous versions */}
            {versions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Clock className="w-8 h-8 text-theme-muted mx-auto mb-2" />
                <p className="text-sm text-theme-tertiary">No version history yet</p>
                <p className="text-xs text-theme-tertiary mt-1">Versions are saved automatically</p>
              </div>
            ) : (
              versions.map((v, i) => (
                <div
                  key={v.id}
                  onClick={() => setSelectedVersion(v)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b theme-divider ${
                    selectedVersion?.id === v.id ? 'theme-active' : 'theme-hover'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-surface-100 dark:bg-surface-700 flex items-center justify-center text-xs font-medium text-surface-500">
                    {versions.length - i}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-theme-primary truncate">
                      {v.title || 'Untitled'}
                    </p>
                    <p className="text-xs text-theme-tertiary">
                      {formatDistanceToNow(new Date(v.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-surface-300" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Preview pane */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
            <div>
              <h4 className="font-medium text-theme-primary">
                {selectedVersion ? selectedVersion.title || 'Untitled' : currentNote?.title || 'Current Note'}
              </h4>
              <p className="text-xs text-theme-tertiary">
                {selectedVersion ? format(new Date(selectedVersion.timestamp), 'MMM d, yyyy h:mm a') : 'Current version'}
              </p>
            </div>
            {selectedVersion && (
              <button
                onClick={() => handleRestore(selectedVersion)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg accent-button text-sm font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded-lg theme-hover text-theme-tertiary hidden lg:block">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="prose dark:prose-invert max-w-none text-sm whitespace-pre-wrap">
              {selectedVersion ? selectedVersion.content : currentNote?.content || 'No content'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
