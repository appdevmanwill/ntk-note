import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { signOut } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import {
  Bell, Bot, ChevronRight, CircleHelp, FolderOpen, LogOut,
  Moon, Settings, Sun, Trash2, User, MessageSquare
} from 'lucide-react';
import BrandMark from './BrandMark';
import ManualSyncButton from './ManualSyncButton';
import UserAvatar from './UserAvatar';
import { resolveThemeMode } from '@/utils/theme';
import { subscribeToDirectChats, isChatUnread } from '@/utils/chatService';

/**
 * Mobile "More" screen — native-style hub for Workspace tools and Account utilities.
 * Logically organized into Workspace and Account & App sections.
 */
export default function MoreView() {
  const {
    profile, settings, setTheme, openSettings, setCurrentView,
    clearAuth, notes, notebooks, reminders
  } = useStore();

  const [unreadChatsCount, setUnreadChatsCount] = useState(0);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setUnreadChatsCount(0);
      return;
    }
    const unsub = subscribeToDirectChats(
      uid,
      loadedChats => {
        const unread = loadedChats.filter(chat => isChatUnread(chat, uid)).length;
        setUnreadChatsCount(unread);
      },
      () => setUnreadChatsCount(0)
    );
    return () => unsub();
  }, []);

  const activeRemindersCount = reminders.length > 0
    ? reminders.filter(r => r.status === 'active').length
    : notes.filter(n => n.reminder && !n.trashed).length;

  const activeNotebooksCount = notebooks.filter(nb => !nb.trashed).length;
  const trashedNotesCount = notes.filter(n => n.trashed).length;
  const trashedNotebooksCount = notebooks.filter(nb => nb.trashed).length;
  const trashedTotalCount = trashedNotesCount + trashedNotebooksCount;

  const resolvedMode = resolveThemeMode(settings.theme);

  const toggleAppearance = () => {
    const next = resolvedMode === 'dark' ? 'light' : 'dark';
    setTheme(next);
  };

  const handleLogout = async () => {
    await signOut(auth).catch(console.error);
    clearAuth();
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto max-w-lg p-4 pb-28 lg:pb-8">
        <h1 className="mb-4 text-2xl font-extrabold text-theme-primary">More</h1>

        {/* Account & Profile Summary Card */}
        <div className="mb-5 flex items-center gap-3.5 rounded-2xl border theme-border p-4 theme-card">
          <UserAvatar profile={profile} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-theme-primary">{profile.name}</p>
            <p className="truncate text-xs text-theme-tertiary">{profile.email || 'Guest user · Local on this device'}</p>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('profile')}
            className="px-3 py-1.5 rounded-xl border theme-border theme-hover text-xs font-semibold text-theme-secondary shrink-0"
            aria-label="View profile"
          >
            Profile
          </button>
        </div>

        {/* Cross-Device Sync Status Card */}
        <div className="mb-5 rounded-2xl border theme-border p-4 theme-card">
          <div className="mb-2.5">
            <p className="text-sm font-bold text-theme-primary">Cross-device sync</p>
            <p className="mt-0.5 text-xs text-theme-tertiary">Push saved changes now while automatic live sync remains on.</p>
          </div>
          <ManualSyncButton variant="full" />
        </div>

        {/* Workspace Tools Section */}
        <div className="mb-5">
          <p className="px-1 mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">
            Workspace
          </p>
          <div className="overflow-hidden rounded-2xl border theme-border theme-card">
            <MenuRow
              icon={FolderOpen}
              label="Notebooks"
              badge={activeNotebooksCount}
              onClick={() => setCurrentView('notebooks')}
            />
            <MenuRow
              icon={Bell}
              label="Reminders"
              badge={activeRemindersCount}
              onClick={() => setCurrentView('reminders')}
              hasTopBorder
            />
            <MenuRow
              icon={MessageSquare}
              label="Messages"
              badge={unreadChatsCount}
              onClick={() => setCurrentView('messages')}
              hasTopBorder
            />
            <MenuRow
              icon={Bot}
              label="NTK AI"
              onClick={() => setCurrentView('ai')}
              hasTopBorder
            />
            <MenuRow
              icon={Trash2}
              label="Recycle Bin"
              badge={trashedTotalCount}
              onClick={() => setCurrentView('trash')}
              hasTopBorder
            />
          </div>
        </div>

        {/* Account & Application Section */}
        <div className="mb-5">
          <p className="px-1 mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">
            Account & Application
          </p>
          <div className="overflow-hidden rounded-2xl border theme-border theme-card">
            <MenuRow
              icon={User}
              label="Profile"
              onClick={() => setCurrentView('profile')}
            />
            <MenuRow
              icon={Settings}
              label="Settings"
              onClick={() => openSettings()}
              hasTopBorder
            />
            <button
              type="button"
              onClick={toggleAppearance}
              aria-label={`Appearance toggle: currently ${resolvedMode === 'dark' ? 'Dark mode' : 'Light mode'}. Click to switch.`}
              className="flex w-full min-h-[48px] items-center gap-3.5 px-4 py-3 text-left transition-colors theme-hover border-t theme-divider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
            >
              {resolvedMode === 'dark' ? (
                <Moon className="h-5 w-5 shrink-0 text-indigo-400 no-transition" aria-hidden="true" />
              ) : (
                <Sun className="h-5 w-5 shrink-0 text-amber-500 no-transition" aria-hidden="true" />
              )}
              <span className="flex-1 text-sm font-medium text-theme-primary">
                Appearance ({resolvedMode === 'dark' ? 'Dark' : 'Light'})
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md accent-soft accent-text shrink-0">
                Switch to {resolvedMode === 'dark' ? 'Light' : 'Dark'}
              </span>
            </button>
            <MenuRow
              icon={CircleHelp}
              label="Help & Shortcuts"
              onClick={() => openSettings('about')}
              hasTopBorder
            />
          </div>
        </div>

        {/* Sign Out Action */}
        <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Sign out of NTK Note"
          className="flex w-full min-h-[48px] items-center justify-center gap-2.5 rounded-2xl border border-red-500/25 bg-red-500/5 px-4 py-3.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-500/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70"
        >
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Sign out
        </button>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-theme-muted">
          <BrandMark className="h-4 w-4 rounded" />
          <span>NTK Note • Your Second Brain</span>
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  icon: Icon,
  label,
  badge,
  onClick,
  hasTopBorder,
}: {
  icon: typeof Settings;
  label: string;
  badge?: number;
  onClick: () => void;
  hasTopBorder?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex w-full min-h-[48px] items-center gap-3.5 px-4 py-3 text-left transition-colors theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
        hasTopBorder ? 'border-t theme-divider' : ''
      }`}
    >
      <Icon className="h-5 w-5 shrink-0 text-theme-secondary no-transition" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-theme-primary">{label}</span>
      {typeof badge === 'number' && badge > 0 && (
        <span className="rounded-full bg-[var(--accent-primary)]/15 px-2 py-0.5 text-xs font-bold accent-text mr-1">
          {badge}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted" aria-hidden="true" />
    </button>
  );
}
