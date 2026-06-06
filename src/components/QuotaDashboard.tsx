import { useState } from 'react';
import { useStore } from '@/store';
import { AlertTriangle, CheckCircle2, Cloud, Database, RefreshCw, Wifi, WifiOff } from 'lucide-react';

export default function QuotaDashboard() {
  const { syncQueue, syncConflicts, online, uid, flushSyncQueue } = useStore();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const runSync = async () => {
    if (!online) {
      setMessage('You are offline. Changes will sync when the connection returns.');
      return;
    }
    if (!uid) {
      setMessage('Cloud sync needs a signed-in Firebase session. Local notes are still saved on this device.');
      return;
    }
    if (syncConflicts.length > 0) {
      setMessage('Resolve sync conflicts before syncing those notes.');
      return;
    }
    if (syncQueue.length === 0) {
      setMessage('No pending changes. Everything local is already queued cleanly.');
      return;
    }

    const before = syncQueue.length;
    setSyncing(true);
    setMessage('Syncing pending changes...');
    await flushSyncQueue();
    const remaining = useStore.getState().syncQueue.length;
    setSyncing(false);
    setMessage(remaining === 0 ? `Synced ${before} pending change${before === 1 ? '' : 's'}.` : `${remaining} change${remaining === 1 ? '' : 's'} still waiting.`);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard
          icon={online ? Wifi : WifiOff}
          label="Connection"
          value={online ? 'Online' : 'Offline'}
          tone={online ? 'good' : 'warn'}
        />
        <SummaryCard
          icon={Cloud}
          label="Cloud session"
          value={uid ? 'Connected' : 'Local only'}
          tone={uid ? 'good' : 'warn'}
        />
        <SummaryCard
          icon={Database}
          label="Queued changes"
          value={syncQueue.length.toString()}
          tone={syncQueue.length === 0 ? 'good' : 'warn'}
        />
      </div>

      <div className="rounded-xl border theme-divider p-4" style={{ backgroundColor: 'var(--input-bg)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-theme-primary">Local-first sync</p>
            <p className="text-xs text-theme-tertiary">
              {syncQueue.length === 0
                ? 'There are no local changes waiting to upload.'
                : `${syncQueue.length} local change${syncQueue.length === 1 ? '' : 's'} waiting to upload.`}
            </p>
          </div>
          <button
            onClick={() => void runSync()}
            disabled={syncing}
            className="px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-60 disabled:cursor-wait inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 no-transition ${syncing ? 'animate-spin' : ''}`} />
            Sync Now
          </button>
        </div>
        {message && (
          <p className="mt-3 text-xs text-theme-tertiary">{message}</p>
        )}
      </div>

      <div className="rounded-xl border theme-divider p-4" style={{ backgroundColor: 'var(--card-bg)' }}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 no-transition" />
          <div>
            <p className="text-sm font-semibold text-theme-primary">Offline-first by design</p>
            <p className="text-xs text-theme-tertiary mt-1">
              Edits save locally first, then upload in batches through the sync queue. Sorting, search, smart views, cleanup, and version snapshots run on this device to avoid extra Firestore reads.
            </p>
          </div>
        </div>
      </div>

      {syncConflicts.length > 0 && (
        <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.24)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 no-transition" />
            <div>
              <p className="text-sm font-semibold text-theme-primary">{syncConflicts.length} sync conflict{syncConflicts.length === 1 ? '' : 's'}</p>
              <p className="text-xs text-theme-tertiary mt-1">Resolve conflicts below before those notes sync again.</p>
            </div>
          </div>
          <div className="space-y-1">
            {syncConflicts.slice(0, 3).map(conflict => (
              <div key={conflict.id} className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--card-bg)' }}>
                <p className="font-semibold text-theme-primary truncate">{conflict.local.title || conflict.remote.title || 'Untitled note'}</p>
                <p className="text-theme-tertiary">
                  Local: {new Date(conflict.local.updatedAt).toLocaleString()} | Cloud: {new Date(conflict.remote.updatedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  tone: 'good' | 'warn';
}) {
  return (
    <div className="rounded-xl border theme-divider p-3" style={{ backgroundColor: 'var(--input-bg)' }}>
      <div className="flex items-center gap-2 text-xs text-theme-tertiary mb-2">
        <Icon className={`w-4 h-4 no-transition ${tone === 'good' ? 'text-emerald-500' : 'text-amber-500'}`} />
        {label}
      </div>
      <p className="font-bold text-theme-primary">{value}</p>
    </div>
  );
}
