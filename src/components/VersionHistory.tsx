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

import {
  getConfirmedUid,
  resolveConfirmedUid,
  isConfirmedSession,
  isStrictConfirmedSession,
  isAuthorizedSession,
  getAuthUid,
  getStoreUid,
} from '@/utils/sessionAuthority';

export const getConfirmedVersionUid = getConfirmedUid;
export { resolveConfirmedUid, isConfirmedSession, isStrictConfirmedSession, isAuthorizedSession };

export interface VersionHistoryUiState {
  uid: string | null;
  noteId: string;
  selectedVersion: NoteVersion | null;
  versions: NoteVersion[];
}

/**
 * Pure state reducer for atomic identity transitions in Version History.
 * When UID transitions, previous account's selectedVersion is IMMEDIATELY cleared to null,
 * and versions are loaded strictly for the new confirmed UID.
 */
export const reduceVersionHistoryUiState = (
  prev: { uid: string | null; noteId: string; selectedVersion: NoteVersion | null; versions: NoteVersion[] },
  nextUid: string | null,
  nextNoteId: string
): VersionHistoryUiState => {
  const confirmed = getConfirmedVersionUid(nextUid);
  const safeNoteId = nextNoteId?.trim() || '';

  if (prev.uid !== confirmed || prev.noteId !== safeNoteId) {
    return {
      uid: confirmed,
      noteId: safeNoteId,
      selectedVersion: null, // Reset immediately on account transition
      versions: confirmed && safeNoteId ? getVersions(safeNoteId, confirmed) : [],
    };
  }

  return prev;
};

export const getVersionHistoryStorageKey = (uid: string | null | undefined, noteId: string): string => {
  const confirmed = getConfirmedVersionUid(uid);
  const safeNoteId = noteId?.trim() || '';
  if (!confirmed || !safeNoteId) {
    return '';
  }
  return `ntk:versions:${confirmed}:${safeNoteId}`;
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

/**
 * Store versions in localStorage strictly scoped by confirmed UID + noteId.
 * STAGE 3A.5 MANDATORY SESSION AUTHORITY & STORED OWNER VALIDATION:
 * 1. Confirms that the current session strictly authorizes reading the requested UID.
 *    Requires Auth UID === Store UID === confirmedUid. No caller overrides.
 * 2. If confirmedUid is absent, invalid, placeholder, or not authorized by the active session,
 *    returns [] immediately (FAIL CLOSED).
 * 3. Stored Owner Validation (P1): Inspects every parsed version entry and excludes any version
 *    whose version.uid is missing, invalid, placeholder, or does not strictly match confirmedUid.
 */
export const getVersions = (
  noteId: string,
  confirmedUid?: string | null
): NoteVersion[] => {
  if (typeof localStorage === 'undefined') return [];
  if (!noteId) return [];
  const confirmed = getConfirmedVersionUid(confirmedUid);
  if (!confirmed) return []; // FAIL CLOSED: empty array
  if (!isAuthorizedSession(confirmed)) return []; // FAIL CLOSED: unconfirmed session or mismatch
  try {
    const key = getVersionHistoryStorageKey(confirmed, noteId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Filter and validate EVERY parsed version (P1 Stored Owner Validation):
    return parsed.filter((item): item is NoteVersion => {
      if (!item || typeof item !== 'object') return false;
      if (typeof item.id !== 'string' || !item.id.trim()) return false;
      if (typeof item.noteId !== 'string' || item.noteId.trim() !== noteId.trim()) return false;
      if (typeof item.timestamp !== 'string' || !item.timestamp.trim()) return false;
      if (typeof item.title !== 'string' && item.title !== undefined) return false;
      if (typeof item.content !== 'string' && item.content !== undefined) return false;

      // Stored version ownership validation:
      // version.uid must exist, be valid non-placeholder, and strictly match confirmed session UID
      const owner = getConfirmedVersionUid(item.uid);
      if (!owner || owner !== confirmed) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
};

/**
 * Persist version into localStorage strictly under the confirmed UID.
 * STAGE 3A.5 MANDATORY SESSION & OWNERSHIP INVARIANT:
 * 1. Requires explicit confirmedUid parameter (NO fallback to version.uid or ambient identity).
 * 2. Requires strict session authority: Auth UID === Store UID === confirmedUid (NO caller overrides).
 * 3. Requires valid version owner matching confirmed session: version.uid === confirmedUid.
 * 4. NEVER rewrites version ownership on mismatch (fails closed with false/no-op).
 */
export const saveVersion = (
  version: NoteVersion,
  confirmedUid: string
): boolean => {
  if (typeof localStorage === 'undefined') return false;
  if (!version?.noteId) return false;

  // 1. Explicit confirmedUid parameter required; omitted/invalid fails closed
  const target = getConfirmedVersionUid(confirmedUid);
  if (!target) return false;

  // 2. Strict session authority: Auth UID === Store UID === target
  if (!isAuthorizedSession(target)) return false;

  // 3. Version owner validation: version.uid must exist, be valid non-placeholder, and match target
  const versionOwner = getConfirmedVersionUid(version?.uid);
  if (!versionOwner || versionOwner !== target) {
    // FAIL CLOSED: missing, placeholder, or mismatched owner. NEVER rewrite ownership!
    return false;
  }

  // 4. Authorized and ownership verified; persist under confirmed namespace
  const versions = getVersions(version.noteId, target);
  // Keep last 50 versions per note per account. Do NOT rewrite version.uid!
  const newVersions = [version, ...versions.filter(v => v.id !== version.id)].slice(0, 50);
  try {
    const key = getVersionHistoryStorageKey(target, version.noteId);
    localStorage.setItem(key, JSON.stringify(newVersions));
    return true;
  } catch (err) {
    console.warn('[VersionHistory] Failed to persist scoped version:', err);
    return false;
  }
};

/**
 * Snapshot current note state locally under confirmed UID.
 * Omitted UID fails closed to null (Section 5 & 11).
 * Confirms that the current session strictly authorizes the save (Section 8 & 11).
 */
export const saveLocalNoteSnapshot = (
  noteId: string,
  title: string,
  content: string,
  source: NoteVersion['source'] = 'manual',
  confirmedUid?: string | null
): NoteVersion | null => {
  if (!noteId) return null;
  const confirmed = getConfirmedVersionUid(confirmedUid);
  if (!confirmed) return null; // FAIL CLOSED: missing or invalid UID never resolves ambiently

  // Session authority verification:
  if (!isAuthorizedSession(confirmed)) {
    return null; // FAIL CLOSED: unconfirmed session or mismatch
  }

  // Safely quarantine and remove any legacy unscoped version history for this note
  cleanupLegacyVersionHistory(noteId);

  const versions = getVersions(noteId, confirmed);
  const lastVersion = versions[0];

  if (lastVersion?.title === title && lastVersion.content === content && lastVersion.source === source) {
    return lastVersion;
  }

  const version: NoteVersion = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    noteId,
    uid: confirmed,
    title,
    content,
    timestamp: new Date().toISOString(),
    source,
  };
  const saved = saveVersion(version, confirmed);
  if (!saved) return null;
  return version;
};

/**
 * Clear versions for a note.
 * DEFENSE-IN-DEPTH SESSION COHERENCE (Section 8 & 13):
 * Explicit UID must NOT bypass session coherence.
 * Both active Firebase Auth UID and Store UID must exist, match, and equal target UID.
 * Fails closed without modifying storage if unconfirmed or mismatched.
 */
export const clearVersions = (
  noteId: string,
  confirmedUid?: string | null
): boolean => {
  if (typeof localStorage === 'undefined') return false;
  if (!noteId) return false;

  const target = getConfirmedVersionUid(confirmedUid);
  if (!target) return false; // FAIL CLOSED: omitted or invalid UID

  if (!isAuthorizedSession(target)) {
    return false; // FAIL CLOSED: unconfirmed session or mismatch
  }

  try {
    const key = getVersionHistoryStorageKey(target, noteId);
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.warn('[VersionHistory] Failed to clear scoped versions:', err);
    return false;
  }
};

/**
 * Delete a specific version.
 * DEFENSE-IN-DEPTH SESSION COHERENCE (Section 8 & 12):
 * Confirms session authority AND validates that the version object has a valid,
 * confirmed owner UID matching that session.
 */
export const deleteVersion = (
  noteId: string,
  versionId: string,
  confirmedUid?: string | null
): boolean => {
  if (typeof localStorage === 'undefined') return false;
  if (!noteId || !versionId) return false;

  const target = getConfirmedVersionUid(confirmedUid);
  if (!target) return false; // FAIL CLOSED: omitted or invalid UID

  if (!isAuthorizedSession(target)) {
    return false; // FAIL CLOSED: unconfirmed session or mismatch
  }

  const versions = getVersions(noteId, target);
  const targetVersion = versions.find(v => v.id === versionId);
  if (!targetVersion) return false;

  // Stored version ownership validation (Section 12):
  const versionOwner = getConfirmedVersionUid(targetVersion.uid);
  if (!versionOwner || versionOwner !== target) {
    return false; // FAIL CLOSED: version has missing, invalid, or mismatched ownership
  }

  const filtered = versions.filter(v => v.id !== versionId);
  try {
    const key = getVersionHistoryStorageKey(target, noteId);
    localStorage.setItem(key, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.warn('[VersionHistory] Failed to update scoped versions after delete:', err);
    return false;
  }
};

const cloudCheckpointPath = (uid: string) => `users/${uid}/note_checkpoints`;

export const getCloudNoteCheckpoints = async (uid: string, noteId: string): Promise<NoteVersion[]> => {
  const confirmed = getConfirmedVersionUid(uid);
  if (!confirmed) return [];
  const snapshot = await getDocs(query(collection(db, cloudCheckpointPath(confirmed)), where('noteId', '==', noteId)));
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
  const confirmed = getConfirmedVersionUid(uid);
  if (!confirmed) return null;

  const version = saveLocalNoteSnapshot(noteId, title, content, 'cloud-checkpoint', confirmed);
  if (!version) return null;

  const checkpointBytes = new Blob([JSON.stringify(version)]).size;
  if (checkpointBytes >= 900_000) {
    throw new Error('This checkpoint is too large for safe cloud sync. Compress images or split the note first.');
  }

  await setDoc(doc(db, cloudCheckpointPath(confirmed), version.id), version);

  const checkpoints = await getCloudNoteCheckpoints(confirmed, noteId);
  await Promise.all(
    checkpoints.slice(10).map(item => deleteDoc(doc(db, cloudCheckpointPath(confirmed), item.id)).catch(console.error))
  );

  return version;
};

export const useVersionHistory = (noteId: string | null, title: string, content: string, uid?: string | null) => {
  const storeUid = useStore(s => s.uid);
  const confirmedSession = resolveConfirmedUid(auth.currentUser?.uid, storeUid);
  const requested = getConfirmedVersionUid(uid);
  const confirmed = (confirmedSession && requested === confirmedSession) ? confirmedSession : null;

  useEffect(() => {
    if (!noteId || (!title && !content) || !confirmed) return;

    // Debounce: save version every 30 seconds of inactivity
    const timer = setTimeout(() => {
      const versions = getVersions(noteId, confirmed);
      const lastVersion = versions[0];
      
      // Only save if content changed
      if (!lastVersion || lastVersion.title !== title || lastVersion.content !== content) {
        saveLocalNoteSnapshot(noteId, title, content, 'auto', confirmed);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [noteId, title, content, confirmed]);
};

export interface ExecuteVersionRestoreParams {
  noteId: string;
  version: NoteVersion;
  expectedSessionUid: string | null;
  onRestore: (version: NoteVersion) => void;
  currentNote?: { title: string; content: string } | null;
}

export interface ExecuteVersionRestoreResult {
  success: boolean;
  reason?: string;
}

/**
 * Event-time restore execution defense.
 * Validates:
 * 1. Current Firebase auth UID exists and is confirmed.
 * 2. Current workspace store UID exists and is confirmed.
 * 3. Auth UID === Store UID.
 * 4. Expected session UID (captured at view open / version select) === Confirmed UID.
 * 5. Version owner UID exists and is valid (Section 14 & 15: ownerless/guest/unknown REJECTED).
 * 6. Version owner UID === Confirmed UID.
 * 7. Target noteId === Version noteId.
 *
 * If ANY condition fails, the restore is REJECTED and onRestore is NEVER called.
 */
export const executeVersionRestore = (
  params: ExecuteVersionRestoreParams
): ExecuteVersionRestoreResult => {
  const authUid = getAuthUid();
  const storeUid = getStoreUid();

  const confirmedUid = resolveConfirmedUid(authUid, storeUid);
  if (!confirmedUid) {
    return { success: false, reason: 'AUTH_MISMATCH: No confirmed session active' };
  }

  const expected = getConfirmedVersionUid(params.expectedSessionUid);
  if (!expected || expected !== confirmedUid) {
    return {
      success: false,
      reason: `AUTH_MISMATCH: Expected session ${params.expectedSessionUid}, active ${confirmedUid}`,
    };
  }

  // Section 14 & 15: VALID CANONICAL VERSION OWNER REQUIRED
  // Historical version used for Restore must contain a valid canonical version.uid.
  // Missing (undefined, null, blank) or placeholder (guest, unknown, default, anonymous) MUST FAIL CLOSED.
  const versionOwner = getConfirmedVersionUid(params.version?.uid);
  if (!versionOwner) {
    return {
      success: false,
      reason: `INVALID_VERSION_OWNER: Version has missing or invalid owner (${params.version?.uid})`,
    };
  }

  if (versionOwner !== confirmedUid) {
    return {
      success: false,
      reason: `AUTH_MISMATCH: Version belongs to ${params.version?.uid}, cannot restore under ${confirmedUid}`,
    };
  }

  if (!params.noteId || params.version.noteId !== params.noteId) {
    return { success: false, reason: 'NOTE_MISMATCH: Target note does not match version note' };
  }

  if (params.currentNote && params.noteId) {
    saveLocalNoteSnapshot(
      params.noteId,
      params.currentNote.title,
      params.currentNote.content,
      'restore',
      confirmedUid
    );
  }

  params.onRestore(params.version);
  return { success: true };
};

export default function VersionHistory({ noteId, onClose, onRestore, presentation = 'modal' }: Props) {
  const { getNoteById, uid: storeUid } = useStore();
  const confirmedUid = resolveConfirmedUid(auth.currentUser?.uid, storeUid);
  
  const currentNote = getNoteById(noteId);

  // Synchronous atomic identity-transition state:
  const [uiState, setUiState] = useState(() => ({
    uid: confirmedUid,
    noteId,
    selectedVersion: null as NoteVersion | null,
    versions: confirmedUid ? getVersions(noteId, confirmedUid) : [],
  }));

  // Synchronous transition guard: If confirmedUid or noteId changed, immediately reset selectedVersion
  if (uiState.uid !== confirmedUid || uiState.noteId !== noteId) {
    setUiState(reduceVersionHistoryUiState(uiState, confirmedUid, noteId));
  }

  const versions = uiState.versions;
  const selectedVersion = uiState.selectedVersion;
  const setSelectedVersion = (v: NoteVersion | null) => setUiState(s => ({ ...s, selectedVersion: v }));

  useEffect(() => {
    let cancelled = false;
    cleanupLegacyVersionHistory(noteId);
    if (!confirmedUid) {
      setUiState(s => ({ ...s, versions: [], selectedVersion: null }));
      return;
    }
    const localVersions = getVersions(noteId, confirmedUid);
    setUiState(s => ({ ...s, versions: localVersions }));

    void getCloudNoteCheckpoints(confirmedUid, noteId)
      .then(cloudVersions => {
        if (cancelled) return;
        const merged = new Map<string, NoteVersion>();
        [...cloudVersions, ...localVersions].forEach(item => merged.set(item.id, item));
        setUiState(s => ({
          ...s,
          versions: [...merged.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        }));
      })
      .catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [noteId, confirmedUid]);

  const handleRestore = (version: NoteVersion) => {
    const currentAuth = auth.currentUser?.uid;
    const currentStore = useStore.getState().uid;
    const currentConfirmed = resolveConfirmedUid(currentAuth, currentStore);
    if (!currentConfirmed || uiState.uid !== currentConfirmed) {
      return; // Fail closed at event boundary
    }

    if (confirm('Restore this version? Current content will be saved as a new version.')) {
      const result = executeVersionRestore({
        noteId,
        version,
        expectedSessionUid: uiState.uid,
        currentNote,
        onRestore,
      });
      if (result.success) {
        onClose();
      } else {
        console.warn('[VersionHistory] Restore aborted:', result.reason);
      }
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
