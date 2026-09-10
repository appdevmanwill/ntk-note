import { useCallback, useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  ArchiveRestore, CheckCircle2, ChevronDown, CloudUpload, DatabaseBackup,
  Download, Loader2, Merge, RefreshCw, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { useStore } from '@/store';
import { formatBytes } from '@/utils/storageHealth';
import { MAX_CLOUD_BACKUPS, type CloudBackupMeta } from '@/utils/cloudBackup';

interface BackupCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RestoreMode = 'merge' | 'replace';

export default function BackupCenterModal({ isOpen, onClose }: BackupCenterModalProps) {
  const { uid, createCloudBackup, fetchCloudBackups, restoreCloudBackup, deleteCloudBackup } = useStore();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [backups, setBackups] = useState<CloudBackupMeta[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [restorePanelId, setRestorePanelId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!uid) {
      setBackups([]);
      return;
    }
    setBackups(null);
    setLoadError('');
    try {
      setBackups(await fetchCloudBackups());
    } catch (err) {
      console.error('Loading cloud backups failed', err);
      setLoadError(err instanceof Error ? err.message : 'Could not load your backups.');
      setBackups([]);
    }
  }, [uid, fetchCloudBackups]);

  useEffect(() => {
    if (isOpen) {
      setBackupStatus(null);
      setRestoreStatus(null);
      setRestorePanelId(null);
      setDeleteConfirmId(null);
      void refreshList();
    }
  }, [isOpen, refreshList]);

  // Modal accessibility: Escape closes, Tab is trapped inside, focus is
  // restored to the opener, and background scrolling is locked. A stable
  // onClose ref keeps this effect on open/close transitions only.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackupNow = async () => {
    setBackupRunning(true);
    setBackupStatus(null);
    try {
      const meta = await createCloudBackup('manual');
      setBackupStatus({
        tone: 'ok',
        text: `Backup saved — ${meta.noteCount} note${meta.noteCount === 1 ? '' : 's'} secured.`,
      });
      await refreshList();
    } catch (err) {
      console.error('Cloud backup failed', err);
      setBackupStatus({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Cloud backup failed.',
      });
    } finally {
      setBackupRunning(false);
    }
  };

  const handleRestore = async (backupId: string, mode: RestoreMode) => {
    setRestoringId(backupId);
    setRestoreStatus(null);
    try {
      const result = await restoreCloudBackup(backupId, mode);
      setRestoreStatus({
        id: backupId,
        text: `Restored ${result.restoredNotes} note${result.restoredNotes === 1 ? '' : 's'} and ${result.restoredNotebooks} notebook${result.restoredNotebooks === 1 ? '' : 's'}${mode === 'replace' ? ' — workspace replaced with this snapshot' : ' — merged into your notes'}.`,
      });
      setRestorePanelId(null);
    } catch (err) {
      console.error('Restore failed', err);
      setRestoreStatus({
        id: backupId,
        text: err instanceof Error ? err.message : 'Restore failed.',
        error: true,
      });
    } finally {
      setRestoringId(null);
    }
  };

  const handleDownload = async (backupId: string, createdAt: string) => {
    const { loadCloudBackupPayload } = await import('@/utils/cloudBackup');
    try {
      if (!uid) return;
      const payload = await loadCloudBackupPayload(uid, backupId);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ntk-note-backup-${format(new Date(createdAt), 'yyyy-MM-dd-HHmm')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Backup download failed', err);
      setRestoreStatus({
        id: backupId,
        text: err instanceof Error ? err.message : 'Download failed.',
        error: true,
      });
    }
  };

  const handleDelete = async (backupId: string) => {
    setDeletingId(backupId);
    try {
      await deleteCloudBackup(backupId);
      setBackups(list => (list ? list.filter(item => item.id !== backupId) : list));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Backup delete failed', err);
      setRestoreStatus({
        id: backupId,
        text: err instanceof Error ? err.message : 'Could not delete this backup.',
        error: true,
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Backup and restore center"
        className="bg-[var(--card-bg)] border theme-border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden max-h-[90dvh] outline-none"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <DatabaseBackup className="w-5 h-5 accent-text no-transition" />
            <h3 className="text-lg font-bold text-theme-primary">Backup &amp; Restore</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
            aria-label="Close backup center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* One-click backup */}
        <div className="p-4 border-b theme-divider space-y-3">
          <button
            onClick={handleBackupNow}
            disabled={!uid || backupRunning}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl accent-gradient text-white shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {backupRunning ? (
              <Loader2 className="w-5 h-5 no-transition animate-spin" />
            ) : (
              <CloudUpload className="w-5 h-5 no-transition" />
            )}
            <div className="text-left">
              <p className="font-bold">Backup now</p>
              <p className="text-xs opacity-80">
                {uid
                  ? 'One click — saves a full snapshot of your notes to your account.'
                  : 'Sign in to save snapshots to your account.'}
              </p>
            </div>
          </button>

          {backupStatus && (
            <p
              className={`text-sm font-medium flex items-center gap-1.5 ${backupStatus.tone === 'ok' ? 'text-emerald-500' : 'text-red-500'}`}
              role="status"
            >
              {backupStatus.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 no-transition" /> : <TriangleAlert className="w-4 h-4 no-transition" />}
              {backupStatus.text}
            </p>
          )}
        </div>

        {/* Snapshot list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-theme-primary">Restore backup</p>
            <span className="text-xs text-theme-tertiary">Last {MAX_CLOUD_BACKUPS} snapshots kept</span>
          </div>

          {backups === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-theme-tertiary text-sm">
              <RefreshCw className="w-4 h-4 animate-spin no-transition" />
              Loading snapshots...
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 rounded-xl border theme-border" style={{ backgroundColor: 'var(--input-bg)' }}>
              <DatabaseBackup className="w-10 h-10 text-theme-muted mx-auto mb-2 no-transition" />
              <p className="text-theme-secondary font-medium text-sm">No snapshots yet</p>
              <p className="text-theme-tertiary text-xs mt-1">Tap “Backup now” to create your first one.</p>
            </div>
          ) : (
            backups.map(backup => (
              <div key={backup.id} className="rounded-xl border theme-border overflow-hidden" style={{ backgroundColor: 'var(--input-bg)' }}>
                <div className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                    <ArchiveRestore className="w-5 h-5 no-transition" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-theme-primary truncate">
                      {format(new Date(backup.createdAt), 'EEE, MMM d, yyyy • h:mm a')}
                    </p>
                    <p className="text-xs text-theme-tertiary">
                      {backup.noteCount} note{backup.noteCount === 1 ? '' : 's'}
                      {' · '}{backup.notebookCount} notebook{backup.notebookCount === 1 ? '' : 's'}
                      {' · '}{formatBytes(backup.sizeBytes)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setRestorePanelId(current => (current === backup.id ? null : backup.id));
                        setDeleteConfirmId(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg accent-button px-3 py-2 text-xs font-bold disabled:opacity-60"
                      disabled={restoringId !== null || deletingId !== null}
                      aria-label={`Restore snapshot from ${format(new Date(backup.createdAt), 'MMM d')}`}
                    >
                      <ArchiveRestore className="w-3.5 h-3.5 no-transition" />
                      Restore
                    </button>
                    <button
                      onClick={() => void handleDownload(backup.id, backup.createdAt)}
                      className="p-2 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
                      aria-label="Download this snapshot as JSON"
                      title="Download as JSON"
                    >
                      <Download className="w-4 h-4 no-transition" />
                    </button>
                    <button
                      onClick={() => {
                        setDeleteConfirmId(backup.id);
                        setRestorePanelId(null);
                      }}
                      className="p-2 rounded-lg theme-hover text-red-500 cursor-pointer"
                      aria-label="Delete this snapshot"
                      title="Delete snapshot"
                    >
                      <Trash2 className="w-4 h-4 no-transition" />
                    </button>
                  </div>
                </div>

                {/* Restore mode chooser */}
                {restorePanelId === backup.id && (
                  <div className="border-t theme-divider p-3 space-y-2">
                    <p className="text-xs font-semibold text-theme-secondary">How should this snapshot be restored?</p>
                    <button
                      onClick={() => void handleRestore(backup.id, 'merge')}
                      disabled={restoringId !== null}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border theme-border theme-hover text-left disabled:opacity-60"
                    >
                      {restoringId === backup.id ? (
                        <Loader2 className="w-4 h-4 text-emerald-500 animate-spin no-transition" />
                      ) : (
                        <Merge className="w-4 h-4 text-emerald-500 no-transition" />
                      )}
                      <span className="text-sm">
                        <span className="font-semibold text-theme-primary">Merge into my notes</span>
                        <span className="block text-xs text-theme-tertiary">Adds missing notes; keeps everything you have now.</span>
                      </span>
                    </button>
                    <button
                      onClick={() => void handleRestore(backup.id, 'replace')}
                      disabled={restoringId !== null}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-left disabled:opacity-60"
                    >
                      <TriangleAlert className="w-4 h-4 text-red-500 no-transition" />
                      <span className="text-sm">
                        <span className="font-semibold text-red-500">Replace all notes</span>
                        <span className="block text-xs text-theme-tertiary">
                          Wipes this workspace back to the snapshot. Notes shared with others are kept.
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => setRestorePanelId(null)}
                      className="w-full rounded-lg px-3 py-1.5 text-xs font-medium text-theme-tertiary theme-hover"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Delete confirmation */}
                {deleteConfirmId === backup.id && (
                  <div className="border-t theme-divider p-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-theme-secondary">Delete this snapshot permanently?</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-theme-tertiary theme-hover"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleDelete(backup.id)}
                        disabled={deletingId !== null}
                        className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                      >
                        {deletingId === backup.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin no-transition" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5 no-transition" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {/* Per-snapshot status */}
                {restoreStatus?.id === backup.id && (
                  <div className={`border-t theme-divider px-3 py-2 flex items-start gap-1.5 text-xs font-medium ${restoreStatus.error ? 'text-red-500' : 'text-emerald-500'}`}>
                    {restoreStatus.error ? (
                      <TriangleAlert className="w-3.5 h-3.5 mt-0.5 no-transition" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 no-transition" />
                    )}
                    {restoreStatus.text}
                  </div>
                )}
              </div>
            ))
          )}

          {loadError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <TriangleAlert className="w-4 h-4 no-transition" />
              {loadError}
              <button onClick={() => void refreshList()} className="underline font-semibold">Retry</button>
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t theme-divider flex items-center gap-2 text-xs text-theme-tertiary">
          <ChevronDown className="w-3.5 h-3.5 no-transition" />
          Snapshots are stored privately in your Firebase account and available on every signed-in device.
        </div>
      </div>
    </div>
  );
}
