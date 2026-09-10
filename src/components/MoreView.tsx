import { useStore } from '@/store';
import { signOut } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import {
  ChevronRight, CircleHelp, Info, Import, LogOut,
  Palette, Settings, ShieldCheck, Sparkles, MessageSquare,
} from 'lucide-react';
import BrandMark from './BrandMark';
import ManualSyncButton from './ManualSyncButton';
import UserAvatar from './UserAvatar';

/**
 * Mobile "More" screen — account, settings shortcuts, and logout.
 * Every row routes to existing application functionality.
 */
export default function MoreView() {
  const { profile, openSettings, clearAuth } = useStore();

  const rows: {
    key: string;
    icon: typeof Settings;
    label: string;
    hint?: string;
    danger?: boolean;
    onClick: () => void;
  }[] = [
    { key: 'messages', icon: MessageSquare, label: 'Messages', onClick: () => useStore.getState().setCurrentView('messages') },
    { key: 'ai', icon: Sparkles, label: 'NTK AI', onClick: () => useStore.getState().setCurrentView('ai') },
    { key: 'settings', icon: Settings, label: 'Settings', onClick: () => openSettings() },
    { key: 'appearance', icon: Palette, label: 'Appearance', onClick: () => openSettings('appearance') },
    { key: 'backup', icon: ShieldCheck, label: 'Data & Backup', onClick: () => openSettings('data') },
    { key: 'import', icon: Import, label: 'Import', onClick: () => openSettings('data') },
    { key: 'help', icon: CircleHelp, label: 'Help & Support', onClick: () => openSettings('about') },
    { key: 'about', icon: Info, label: 'About NTK Note', onClick: () => openSettings('about') },
  ];

  const handleLogout = async () => {
    await signOut(auth).catch(console.error);
    clearAuth();
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto max-w-2xl p-4 pb-28 lg:pb-8">
        <h1 className="mb-4 text-2xl font-bold text-theme-primary">More</h1>

        {/* Account card */}
        <div className="mb-4 flex items-center gap-4 rounded-2xl border theme-border p-4 theme-card">
          <UserAvatar profile={profile} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-theme-primary">{profile.name}</p>
            <p className="truncate text-sm text-theme-tertiary">{profile.email || 'Guest — local only'}</p>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border theme-border p-4 theme-card">
          <div className="mb-3">
            <p className="text-sm font-bold text-theme-primary">Cross-device sync</p>
            <p className="mt-0.5 text-xs text-theme-tertiary">Push saved changes now while automatic live sync remains on.</p>
          </div>
          <ManualSyncButton variant="full" />
        </div>

        {/* Menu rows */}
        <div className="overflow-hidden rounded-2xl border theme-border theme-card">
          {rows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              onClick={row.onClick}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400/70 ${
                index > 0 ? 'border-t theme-divider' : ''
              }`}
            >
              <row.icon className={`h-5 w-5 shrink-0 ${row.danger ? 'text-red-500' : 'text-theme-tertiary'}`} aria-hidden="true" />
              <span className="flex-1 text-sm font-medium text-theme-primary">{row.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted" aria-hidden="true" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-3.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Logout
        </button>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-theme-muted">
          <BrandMark className="h-4 w-4 rounded" />
          <span>NTK Note • Your Second Brain</span>
        </div>
      </div>
    </div>
  );
}
