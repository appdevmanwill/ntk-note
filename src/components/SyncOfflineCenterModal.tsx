import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  WifiOff,
  Clock,
  HardDrive,
  FileText,
  Image,
  ChevronDown,
  ChevronUp,
  X,
  Activity,
} from 'lucide-react';
import { useStore } from '@/store';
import { getPendingMediaForUser, type OfflineMediaItem } from '@/utils/offlineMediaQueue';
import { getTabCoordinator } from '@/utils/tabCoordinator';
import { getPerformanceSnapshot } from '@/utils/performanceMetrics';
import { getAiGatewayStatus } from '@/utils/ntkAi';

interface SyncOfflineCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConflictResolver?: () => void;
}

export default function SyncOfflineCenterModal({
  isOpen,
  onClose,
  onOpenConflictResolver,
}: SyncOfflineCenterModalProps) {
  const {
    uid,
    online,
    syncQueue,
    syncConflicts,
    syncStatus,
    syncMessage,
    lastManualSyncAt,
    manualSync,
    notes,
    conflictRecoveryNotice,
  } = useStore();

  const [pendingMedia, setPendingMedia] = useState<OfflineMediaItem[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const tabCoordinator = getTabCoordinator();
  const isLeader = tabCoordinator.getIsLeader();
  const tabId = tabCoordinator.tabId;

  const performanceSnapshot = getPerformanceSnapshot(isLeader ? 'leader' : 'follower');

  useEffect(() => {
    if (!isOpen) return;
    void getAiGatewayStatus()
      .then(status => setIsOwner(Boolean(status?.isOwner)))
      .catch(() => setIsOwner(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !uid) return;
    void getPendingMediaForUser(uid).then(items => setPendingMedia(items));
  }, [isOpen, uid, syncStatus]);

  if (!isOpen) return null;

  const noteChangesCount = syncQueue.filter(
    item => (item.entityType || 'note') === 'note'
  ).length;
  const notebookChangesCount = syncQueue.filter(
    item => item.entityType === 'notebook'
  ).length;
  const mediaCount = pendingMedia.length;
  const totalPending = syncQueue.length + mediaCount;
  const hasConflicts = syncConflicts.length > 0;

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const result = await manualSync();
      if (result.conflicts > 0) {
        setSyncFeedback(
          `Available changes synced. ${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'} still need review.`
        );
      } else if (result.mediaDetails?.needsAttention && result.mediaDetails.needsAttention > 0) {
        setSyncFeedback('Your notes are synced. Some files need attention before they can upload.');
      } else if (
        result.remainingChanges > 0 ||
        (result.mediaDetails?.pendingTotal && result.mediaDetails.pendingTotal > 0)
      ) {
        setSyncFeedback('Your notes are synced. Some files are waiting to upload and will retry automatically.');
      } else {
        setSyncFeedback('Everything is up to date.');
      }
      if (uid) {
        const media = await getPendingMediaForUser(uid);
        setPendingMedia(media);
      }
    } catch (err) {
      setSyncFeedback(
        err instanceof Error ? err.message : 'Sync could not finish. Your data remains saved on this device.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (isoString?: string | null) => {
    if (!isoString) return 'Not yet recorded';
    try {
      const d = new Date(isoString);
      return isNaN(d.getTime()) ? isoString : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();
    } catch {
      return isoString;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-center-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl border theme-border theme-card shadow-2xl p-6 overflow-hidden space-y-6">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b theme-divider pb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${
              !online
                ? 'bg-zinc-500/10 text-zinc-400'
                : hasConflicts
                  ? 'bg-amber-500/10 text-amber-500'
                  : totalPending > 0
                    ? 'bg-blue-500/10 text-blue-500'
                    : 'bg-emerald-500/10 text-emerald-500'
            }`}>
              {!online ? (
                <WifiOff className="w-6 h-6" />
              ) : hasConflicts ? (
                <RefreshCw className="w-6 h-6 animate-spin" />
              ) : totalPending > 0 ? (
                <RefreshCw className={`w-6 h-6 ${isSyncing ? 'animate-spin' : ''}`} />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>
            <div>
              <h2 id="sync-center-title" className="text-lg font-bold text-theme-primary">
                Sync & Offline Center
              </h2>
              <p className="text-xs text-theme-secondary mt-0.5">
                {!online
                  ? "You're currently offline. Everything you write is safely saved on this device."
                  : hasConflicts
                    ? "Safe Recovery in progress: Preserving simultaneous edits..."
                    : conflictRecoveryNotice
                      ? "Recovered edits saved. Everything is safely preserved."
                      : totalPending > 0
                        ? `${totalPending} change${totalPending === 1 ? '' : 's'} waiting to synchronize.`
                        : 'All your notes and media are synchronized with the cloud.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary hover:text-theme-primary cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Safe Recovery Notice Banner */}
        {conflictRecoveryNotice && !hasConflicts && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <div className="text-xs text-theme-primary">
                <span className="font-semibold">Recovered edits saved:</span> Your unsynced edits were safely preserved as a new note.
              </div>
            </div>
            {onOpenConflictResolver && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenConflictResolver();
                }}
                className="px-3 py-1.5 rounded-lg border theme-border text-xs font-semibold text-theme-secondary theme-hover cursor-pointer shrink-0"
              >
                Review Notice
              </button>
            )}
          </div>
        )}

        {/* Conflict Auto-Recovery in progress */}
        {hasConflicts && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
              <div className="text-xs text-theme-primary">
                <span className="font-semibold">Safe Recovery:</span> Preserving simultaneous edits into a separate copy...
              </div>
            </div>
          </div>
        )}

        {/* Status Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/30 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-theme-tertiary">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Available Offline</span>
            </div>
            <div className="text-lg font-bold text-theme-primary">
              {notes.length}
            </div>
          </div>

          <div className="p-3 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/30 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-theme-tertiary">
              <FileText className="w-3.5 h-3.5" />
              <span>Notes Waiting</span>
            </div>
            <div className="text-lg font-bold text-theme-primary">
              {noteChangesCount + notebookChangesCount}
            </div>
          </div>

          <div className="p-3 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/30 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-theme-tertiary">
              <Image className="w-3.5 h-3.5" />
              <span>Media Waiting</span>
            </div>
            <div className="text-lg font-bold text-theme-primary">
              {mediaCount}
            </div>
          </div>

          <div className="p-3 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/30 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-theme-tertiary">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Needs Attention</span>
            </div>
            <div className={`text-lg font-bold ${syncConflicts.length > 0 ? 'text-amber-500' : 'text-theme-primary'}`}>
              {syncConflicts.length + pendingMedia.filter(m => m.requiresUserAction).length}
            </div>
          </div>
        </div>

        {/* Sync Summary Row */}
        <div className="flex items-center justify-between text-xs text-theme-secondary px-1">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-theme-tertiary" />
            <span>Last successful sync:</span>
          </div>
          <span className="font-medium text-theme-primary">
            {formatTime(lastManualSyncAt)}
          </span>
        </div>

        {/* Feedback Message */}
        {(syncFeedback || syncMessage) && (
          <div className="text-xs p-3 rounded-xl bg-[var(--app-bg-subtle)]/50 border theme-border text-theme-secondary">
            {syncFeedback || syncMessage}
          </div>
        )}

        {/* Primary Action Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={isSyncing || !online}
            aria-label={isSyncing ? 'Syncing notes now' : !online ? 'Offline sync paused' : 'Sync now'}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl accent-button text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing now...' : !online ? 'Offline (Sync Paused)' : 'Sync Now'}</span>
          </button>
        </div>

        {/* Collapsible Owner Diagnostics — strictly gated for system owners */}
        {isOwner && (
          <div className="border-t theme-divider pt-3">
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="w-full flex items-center justify-between text-xs font-semibold text-theme-tertiary hover:text-theme-secondary py-1 cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                <span>Owner Diagnostics & Health</span>
              </div>
              {showDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDiagnostics && (
              <div className="mt-3 p-3 rounded-xl bg-[var(--app-bg-subtle)]/40 border theme-border space-y-2 text-[11px] font-mono text-theme-secondary">
                <div className="flex justify-between">
                  <span>Tab Coordinator:</span>
                  <span className={isLeader ? 'text-emerald-400 font-bold' : 'text-zinc-400'}>
                    {isLeader ? 'Leader (Active Queue Drainer)' : 'Follower Tab'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tab ID:</span>
                  <span className="truncate max-w-[200px]">{tabId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Service Worker:</span>
                  <span className="text-theme-primary">ntk-note-offline-v12</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Listeners:</span>
                  <span className="text-theme-primary">{performanceSnapshot.activeListenersCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Startup Duration:</span>
                  <span className="text-theme-primary">
                    {performanceSnapshot.startupDurationMs !== null ? `${performanceSnapshot.startupDurationMs} ms` : 'Pending'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Worker Requests:</span>
                  <span className="text-theme-primary">{performanceSnapshot.workerRequestCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Storage Guard Target:</span>
                  <span className="text-theme-primary">8.0 GB (95% safety pause)</span>
                </div>
                <div className="flex justify-between">
                  <span>Firebase Plan:</span>
                  <span className="text-emerald-400">Spark ($0/mo, 0 Functions, 1 DB)</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
