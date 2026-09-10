import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { ArrowLeft, BellRing, Menu, PanelLeftOpen, Search } from 'lucide-react';
import BrandMark from './BrandMark';
import ManualSyncButton from './ManualSyncButton';
import UserAvatar from './UserAvatar';
import AccountMenu from './AccountMenu';

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return isDesktop;
};

const viewTitles: Record<string, string> = {
  'home': 'NTK Note',
  'all-notes': 'Notes',
  'notebooks': 'Notebooks',
  'reminders': 'Reminders',
  'messages': 'Messages',
  'ai': 'NTK AI',
  'trash': 'Recycle Bin',
  'settings': 'Settings',
  'profile': 'My Profile',
  'search': 'Search',
  'more': 'More',
  'templates': 'Templates',
  'tags': 'Tags',
  'starred': 'Starred',
  'archived': 'Archived',
  'shared': 'Share Center',
  'notifications': 'Notifications',
};

/**
 * Application top bar.
 * Desktop: Sidebar collapse toggle + search/notifications/sync/account.
 * Mobile: Contextual top app bar tailored to the active screen with clean Back navigation.
 * Automatically yields full screen to Note Editor and Active Chat on phone viewports.
 */
export default function TopBar() {
  const {
    profile, settings, updateSettings,
    currentView, setCurrentView, navigateBack,
    sidebarOpen, setSidebarOpen,
    notifications, editingNote, activeChatId,
  } = useStore();

  const isDesktop = useIsDesktop();
  const unreadCount = notifications.filter(n => !n.readAt && !n.dismissedAt).length;
  const collapsed = settings.sidebarCollapsed;
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Phone layouts: Yield top space to immersive note editing or active chat conversation.
  if (!isDesktop && (editingNote || (currentView === 'messages' && activeChatId))) {
    return null;
  }

  const toggleSidebar = () => {
    if (isDesktop) {
      updateSettings({ sidebarCollapsed: !collapsed });
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  };

  const isHome = currentView === 'home';
  const isRootTab = currentView === 'home' || currentView === 'all-notes' || currentView === 'more';

  return (
    <header
      className="shrink-0 border-b theme-divider select-none"
      style={{ paddingTop: 'env(safe-area-inset-top)', backgroundColor: 'var(--card-bg)' }}
      inert={sidebarOpen || undefined}
    >
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
        {/* Left Side: Desktop Sidebar Toggle or Mobile Contextual Brand/Back */}
        <div className="flex items-center gap-2 min-w-0">
          {isDesktop ? (
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
              aria-label="Toggle navigation sidebar"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          ) : (
            !isRootTab ? (
              <button
                type="button"
                onClick={navigateBack}
                className="flex h-11 w-11 items-center justify-center rounded-xl theme-hover text-theme-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 shrink-0"
                aria-label={`Back from ${viewTitles[currentView] || 'screen'}`}
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : isHome ? (
              <button
                type="button"
                onClick={() => setCurrentView('home')}
                className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 rounded-lg min-h-[44px]"
                aria-label="NTK Note home"
              >
                <BrandMark className="h-7 w-7 rounded-lg" />
                <span className="text-base font-extrabold tracking-tight text-theme-primary">NTK Note</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 min-h-[44px]">
                <h1 className="text-lg font-bold text-theme-primary">{viewTitles[currentView] || 'NTK Note'}</h1>
              </div>
            )
          )}

          {!isDesktop && !isHome && !isRootTab && (
            <h1 className="text-base font-bold text-theme-primary truncate">
              {viewTitles[currentView] || 'NTK Note'}
            </h1>
          )}
        </div>

        {/* Right Side: Quick Utilities & Identity */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ManualSyncButton variant="topbar" />

          {/* Search Shortcut — visible on desktop or when on Notes */}
          {(isDesktop || currentView === 'all-notes') && (
            <button
              type="button"
              onClick={() => setCurrentView('search')}
              aria-label="Search notes"
              title="Search notes"
              className={`flex h-10 w-10 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
                currentView === 'search' ? 'theme-active' : 'theme-hover text-theme-secondary'
              }`}
            >
              <Search className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          {/* Notifications button */}
          <button
            type="button"
            onClick={() => setCurrentView('notifications')}
            aria-label={`Notifications${unreadCount ? ` — ${unreadCount} unread` : ''}`}
            title="Notifications"
            className={`relative flex h-10 w-10 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
              currentView === 'notifications' ? 'theme-active' : 'theme-hover text-theme-secondary'
            }`}
          >
            <BellRing className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Avatar Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              aria-label="Account and profile menu"
              title="Account Menu"
              className="flex h-10 w-10 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 rounded-full"
            >
              <UserAvatar profile={profile} size="sm" />
            </button>
            <div className="absolute right-0 top-12 z-50">
              <AccountMenu isOpen={showAccountMenu} onClose={() => setShowAccountMenu(false)} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
