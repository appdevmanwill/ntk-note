import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { db, auth } from '@/utils/firebase';
import { History, X, RotateCcw, Clock, Eye, ChevronRight } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';

export interface NoteVersion {
  id: string;
  noteId: string;
  uid?: string;
  title: string;
  content: string;
  timestamp: string;
  source?: 'auto' | 'manual' | 'cloud-checkpoint' | 'restore';
}

interface Props {
  noteId: string;
  onClose: () => void;
  onRestore: (version: NoteVersion) => void;
  presentation?: 'modal' | 'panel';
}

// ── UID-Scoped Version History Storage Keys (S3-002 Remediation) ──

export const getVersionHistoryStorageKey = (uid: string | null | undefined, noteId: string): string => {
  const safeUid = uid?.trim() || 'guest';
  const safeNoteId = noteId?.trim() || '';
  if (!safeNoteId) {
    throw new Error('Note ID is required to compute version history storage key');
  }
  return `ntk:versions:${safeUid}:${safeNoteId}`;
};

export const getLegacyVersionHistoryKey = (noteId: string): string => {
  return `ntk-versions-${noteId?.trim() || ''}`;
};

/**
 * Legacy Version History Policy:
 * Unscoped history (`ntk-versions-${noteId}`) cannot safely be attributed to
 * the currently authenticated account, especially for shared notes where multiple
 * users legitimately collaborate on the same note ID.
 * Therefore, legacy unscoped version history is NEVER automatically migrated into
 * a user's scoped history.
 * Obsolete legacy keys are safely quarantined and removed so older un-isolated
 * version history does not remain accessible to other accounts on this browser.
 */
export const cleanupLegacyVersionHistory = (noteId: string): void => {
  if (typeof localStorage === 'undefined') return;
  if (!noteId) return;
  try {
    localStorage.removeItem(getLegacyVersionHistoryKey(noteId));
  } catch {}
};

// Store versions in localStorage strictly scoped by UID + noteId
export const getVersions = (noteId: string, uid?: string | null): NoteVersion[] => {
  if (typeof localStorage === 'undefined') return [];
  if (!noteId) return [];
  const effectiveUid = uid !== undefined ? (uid?.trim() || 'guest') : (auth.currentUser?.uid || useStore.getState().uid || 'guest');
  try {
    const key = getVersionHistoryStorageKey(effectiveUid, noteId);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const saveVersion = (version: NoteVersion, uid?: string | null): void => {
  if (typeof localStorage === 'undefined') return;
  if (!version?.noteId) return;
  const effectiveUid = uid !== undefined ? (uid?.trim() || 'guest') : (version.uid?.trim() || auth.currentUser?.uid || useStore.getState().uid || 'guest');
  const versions = getVersions(version.noteId, effectiveUid);
  const versionWithUid: NoteVersion = { ...version, uid: effectiveUid };
  // Keep last 50 versions per note per account
  const newVersions = [versionWithUid, ...versions.filter(v => v.id !== version.id)].slice(0, 50);
  const key = getVersionHistoryStorageKey(effectiveUid, version.noteId);
  try {
    localStorage.setItem(key, JSON.stringify(newVersions));
  } catch (err) {
    console.warn('[VersionHistory] Failed to persist scoped version:', err);
  }
};

export const saveLocalNoteSnapshot = (
  noteId: string,
  title: string,
  content: string,
  source: NoteVersion['source'] = 'manual',
  uid?: string | null
): NoteVersion | null => {
  if (!noteId) return null;
  const effectiveUid = uid !== undefined ? (uid?.trim() || 'guest') : (auth.currentUser?.uid || useStore.getState().uid || 'guest');

  // Safely quarantine and remove any legacy unscoped version history for this note
  cleanupLegacyVersionHistory(noteId);

  const versions = getVersions(noteId, effectiveUid);
  const lastVersion = versions[0];

  if (lastVersion?.title === title && lastVersion.content === content && lastVersion.source === source) {
    return lastVersion;
  }

  const version: NoteVersion = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    noteId,
    uid: effectiveUid,
    title,
    content,
    timestamp: new Date().toISOString(),
    source,
  };
  saveVersion(version, effectiveUid);
  return version;
};

export const clearVersions = (noteId: string, uid?: string | null): void => {
  if (typeof localStorage === 'undefined') return;
  if (!noteId) return;
  const effectiveUid = uid !== undefined ? (uid?.trim() || 'guest') : (auth.currentUser?.uid || useStore.getState().uid || 'guest');
  try {
    const key = getVersionHistoryStorageKey(effectiveUid, noteId);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[VersionHistory] Failed to clear scoped versions:', err);
  }
};

export const deleteVersion = (noteId: string, versionId: string, uid?: string | null): void => {
  if (typeof localStorage === 'undefined') return;
  if (!noteId || !versionId) return;
  const effectiveUid = uid !== undefined ? (uid?.trim() || 'guest') : (auth.currentUser?.uid || useStore.getState().uid || 'guest');
  const versions = getVersions(noteId, effectiveUid);
  const filtered = versions.filter(v => v.id !== versionId);
  const key = getVersionHistoryStorageKey(effectiveUid, noteId);
  try {
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch (err) {
    console.warn('[VersionHistory] Failed to update scoped versions after delete:', err);
  }
};

const cloudCheckpointPath = (uid: string) => `users/${uid}/note_checkpoints`;

export const getCloudNoteCheckpoints = async (uid: string, noteId: string): Promise<NoteVersion[]> => {
  const snapshot = await getDocs(query(collection(db, cloudCheckpointPath(uid)), where('noteId', '==', noteId)));
  return snapshot.docs
    .map(item => item.data() as NoteVersion)
    .filter(item => item.noteId === noteId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export const saveCloudNoteCheckpoint = async (
  uid: string | null,
  noteId: string,
  title: string,
  content: string
) => {
  const version = saveLocalNoteSnapshot(noteId, title, content, 'cloud-checkpoint', uid);
  if (!uid) return version;

  const checkpointBytes = new Blob([JSON.stringify(version)]).size;
  if (checkpointBytes >= 900_000) {
    throw new Error('This checkpoint is too large for safe cloud sync. Compress images or split the note first.');
  }

  if (version) {
    await setDoc(doc(db, cloudCheckpointPath(uid), version.id), version);
  }

  const checkpoints = await getCloudNoteCheckpoints(uid, noteId);
  await Promise.all(
    checkpoints.slice(10).map(item => deleteDoc(doc(db, cloudCheckpointPath(uid), item.id)).catch(console.error))
  );

  return version;
};

// Hook to automatically save versions with UID scoping
export const useVersionHistory = (noteId: string | null, title: string, content: string, uid?: string | null) => {
  const storeUid = useStore(s => s.uid);
  const effectiveUid = uid !== undefined ? uid : storeUid;

  useEffect(() => {
    if (!noteId || (!title && !content)) return;

    // Debounce: save version every 30 seconds of inactivity
    const timer = setTimeout(() => {
      const versions = getVersions(noteId, effectiveUid);
      const lastVersion = versions[0];
      
      // Only save if content changed
      if (!lastVersion || lastVersion.title !== title || lastVersion.content !== content) {
        saveLocalNoteSnapshot(noteId, title, content, 'auto', effectiveUid);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [noteId, title, content, effectiveUid]);
};

export default function VersionHistory({ noteId, onClose, onRestore, presentation = 'modal' }: Props) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<NoteVersion | null>(null);
  const { getNoteById, uid } = useStore();
  
  const currentNote = getNoteById(noteId);

  useEffect(() => {
    let cancelled = false;
    cleanupLegacyVersionHistory(noteId);
    const localVersions = getVersions(noteId, uid);
    setVersions(localVersions);

    if (uid) {
      void getCloudNoteCheckpoints(uid, noteId)
        .then(cloudVersions => {
          if (cancelled) return;
          const merged = new Map<string, NoteVersion>();
          [...cloudVersions, ...localVersions].forEach(item => merged.set(item.id, item));
          setVersions(
            [...merged.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          );
        })
        .catch(console.error);
    }

    return () => {
      cancelled = true;
    };
  }, [noteId, uid]);

  const handleRestore = (version: NoteVersion) => {
    if (confirm('Restore this version? Current content will be saved as a new version.')) {
      // Save current state first with scoped UID
      if (currentNote) {
        saveLocalNoteSnapshot(noteId, currentNote.title, currentNote.content, 'restore', uid);
      }
      onRestore(version);
      onClose();
    }
  };

  const content = (
    <>
        {/* Versions list */}
        <div className="w-full border-r theme-divider flex flex-col sm:w-72">
          <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-500" />
              <h3 className="font-semibold text-theme-primary">Version History</h3>
            </div>
            <button onClick={onClose} aria-label="Close version history" className="p-1 rounded-lg theme-hover text-theme-tertiary lg:hidden">
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
                      {v.source ? ` - ${v.source === 'cloud-checkpoint' ? 'cloud checkpoint' : v.source}` : ''}
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
            <button onClick={onClose} aria-label="Close version history" className="p-1 rounded-lg theme-hover text-theme-tertiary hidden lg:block">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="prose dark:prose-invert max-w-none text-sm whitespace-pre-wrap">
              {selectedVersion ? selectedVersion.content : currentNote?.content || 'No content'}
            </div>
          </div>
        </div>

    </>
  );

  if (presentation === 'panel') {
    return (
      <div
        className="fixed right-4 top-20 bottom-4 z-50 hidden w-[680px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border theme-menu shadow-2xl xl:flex animate-slide-in-right"
        role="dialog"
        aria-modal="false"
        aria-label="Version history"
      >
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-w-3xl max-h-[80vh] theme-card rounded-2xl border overflow-hidden animate-scale-in">
        {content}
      </div>
    </div>
  );
}
