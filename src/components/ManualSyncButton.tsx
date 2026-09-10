import { AlertTriangle, CheckCircle2, CloudOff, CircleAlert, RefreshCw, WifiOff } from 'lucide-react';
import { useStore } from '@/store';

interface ManualSyncButtonProps {
  variant?: 'topbar' | 'full' | 'inline';
}

export default function ManualSyncButton({ variant = 'inline' }: ManualSyncButtonProps) {
  const {
    uid, online, syncQueue, syncStatus, syncMessage, lastManualSyncAt, manualSync, setSyncCenterOpen,
  } = useStore();
  const syncing = syncStatus === 'syncing';

  const runSync = () => {
    if (syncStatus === 'attention') {
      setSyncCenterOpen(true);
      return;
    }
    void manualSync().catch(() => {
      // The store retains a user-facing message and keeps unsent changes queued.
    });
  };

  const Icon = !uid
    ? CloudOff
    : !online
      ? WifiOff
      : syncStatus === 'success'
        ? CheckCircle2
        : syncStatus === 'attention'
          ? AlertTriangle
          : syncStatus === 'error'
            ? CircleAlert
            : RefreshCw;

  const label = syncing
    ? 'Syncing...'
    : syncStatus === 'success'
      ? 'Synced'
      : syncStatus === 'attention'
        ? 'Review sync'
        : syncStatus === 'error'
          ? 'Try sync again'
          : 'Sync now';

  const buttonClass = variant === 'topbar'
    ? 'hidden lg:inline-flex h-10 items-center justify-center gap-2 rounded-xl border theme-border px-3 text-sm font-semibold text-theme-secondary theme-hover'
    : variant === 'full'
      ? 'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold accent-button'
      : 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium accent-button';

  return (
    <div className={variant === 'full' ? 'space-y-2' : 'relative'}>
      <button
        type="button"
        onClick={runSync}
        disabled={syncing}
        aria-busy={syncing}
        aria-label={syncing ? 'Syncing app data' : 'Sync app data now'}
        title={syncMessage || 'Sync this device with your other signed-in devices'}
        className={`${buttonClass} disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70`}
      >
        <Icon
          className={`h-4 w-4 shrink-0 no-transition ${syncing ? 'animate-spin' : ''} ${syncStatus === 'success' ? 'text-emerald-400' : syncStatus === 'attention' ? 'text-amber-400' : ''}`}
          aria-hidden="true"
        />
        <span>{variant === 'topbar' && syncStatus === 'idle' ? 'Sync' : label}</span>
        {variant === 'topbar' && syncQueue.length > 0 && !syncing && (
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: 'var(--accent-primary)' }}
            aria-label={`${syncQueue.length} queued change${syncQueue.length === 1 ? '' : 's'}`}
          >
            {syncQueue.length > 9 ? '9+' : syncQueue.length}
          </span>
        )}
      </button>

      {variant === 'full' && (
        <p className="px-1 text-xs text-theme-tertiary">
          {syncMessage || (lastManualSyncAt
            ? `Last manually synced at ${new Date(lastManualSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
            : 'Automatic sync stays on. Use this whenever you want an immediate cloud confirmation.')}
        </p>
      )}
    </div>
  );
}
