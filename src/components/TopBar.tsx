import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { BellRing, Menu, PanelLeftOpen, Search } from 'lucide-react';
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

/**
 * Application top bar. Desktop: collapse toggle + search/notifications/account.
 * Mobile: doubles as the fixed app bar with the brand centered-left.
 */
export default function TopBar() {
  const {
    profile, settings, updateSettings,
    currentView, setCurrentView,
    sidebarOpen, setSidebarOpen,
    notifications,
  } = useStore();

  const isDesktop = useIsDesktop();
  const unreadCount = notifications.filter(n => !n.readAt && !n.dismissedAt).length;
  const collapsed = settings.sidebarCollapsed;
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const toggleSidebar = () => {
    if (isDesktop) {
      updateSettings({ sidebarCollapsed: !collapsed });
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  };

  return (
    <header
      className="shrink-0 border-b theme-divider"
      style={{ paddingTop: 'env(safe-area-inset-top)', backgroundColor: 'var(--card-bg)' }}
      inert={sidebarOpen || undefined}
    >
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
        aria-label={window.innerWidth >= 1024 ? 'Toggle navigation sidebar' : 'Open navigation menu'}
      >
        {isDesktop && collapsed ? (
          <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
      </button>

      <button
        type="button"
        onClick={() => setCurrentView('home')}
        className="flex items-center gap-2 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 rounded-lg"
        aria-label="NTK Note home"
      >
        <BrandMark className="h-7 w-7 rounded-lg" />
        <span className="text-sm font-extrabold tracking-tight text-theme-primary">NTK Note</span>
      </button>

      <div className="flex-1" />

      <ManualSyncButton variant="topbar" />

      <button
        type="button"
        onClick={() => setCurrentView('search')}
        aria-label="Search notes"
        title="Search notes"
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
          currentView === 'search' ? 'theme-active' : 'theme-hover text-theme-secondary'
        }`}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        onClick={() => setCurrentView('notifications')}
        aria-label={`Notifications${unreadCount ? ` — ${unreadCount} unread` : ''}`}
        title="Notifications"
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
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
    </header>
  );
}
