import { Sparkles, RefreshCw, X } from 'lucide-react';

interface PwaUpdatePromptProps {
  show: boolean;
  onUpdateNow: () => void;
  onLater: () => void;
  isUpdating?: boolean;
}

export default function PwaUpdatePrompt({
  show,
  onUpdateNow,
  onLater,
  isUpdating = false,
}: PwaUpdatePromptProps) {
  if (!show) return null;

  return (
    <aside
      className="fixed bottom-5 right-5 z-50 max-w-md w-[calc(100%-2.5rem)] rounded-2xl border theme-border theme-card shadow-2xl p-4 animate-slide-up bg-[var(--card-bg)]/95 backdrop-blur-md"
      role="region"
      aria-label="App update notification"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl accent-soft shrink-0">
          <Sparkles className="w-5 h-5 accent-text" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-bold text-theme-primary">
            An update is ready
          </h4>
          <p className="text-xs text-theme-secondary mt-0.5 leading-relaxed">
            A new version of NTK Note is available. Your notes will stay safely preserved on this device.
          </p>

          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={onUpdateNow}
              disabled={isUpdating}
              aria-label={isUpdating ? 'Updating application' : 'Update now'}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg accent-button text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Updating...' : 'Update now'}</span>
            </button>
            <button
              type="button"
              onClick={onLater}
              disabled={isUpdating}
              className="px-3 py-1.5 rounded-lg border theme-border text-xs font-medium text-theme-secondary theme-hover cursor-pointer"
            >
              Later
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onLater}
          className="p-1 rounded-lg theme-hover text-theme-tertiary"
          aria-label="Dismiss update prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
