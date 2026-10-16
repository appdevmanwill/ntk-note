import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  LogOut,
  RefreshCw,
  Shield,
  ShieldCheck,
  User, Settings, Moon, Sun, CircleHelp,
} from 'lucide-react';
import { useStore } from '@/store';
import { getAiGatewayStatus, type AiGatewayStatus } from '@/utils/ntkAi';
import { signOut, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/utils/firebase';
import { getTabCoordinator } from '@/utils/tabCoordinator';
import UserAvatar from './UserAvatar';
import { resolveThemeMode } from '@/utils/theme';

export interface AccountMenuProps {
  isOpen: boolean;
  onClose: () => void;
  placement?: 'top' | 'bottom';
}

export default function AccountMenu({ isOpen, onClose, placement = 'top' }: AccountMenuProps) {
  const {
    profile,
    setCurrentView,
    openSettings,
    syncStatus,
    manualSync,
    online,
    clearAuth,
    setSyncCenterOpen,
    settings, setTheme, setCommandPaletteOpen,
  } = useStore();

  const syncing = syncStatus === 'syncing';

  const [aiStatus, setAiStatus] = useState<AiGatewayStatus | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (isOpen) {
      void getAiGatewayStatus().then((st: AiGatewayStatus) => setAiStatus(st)).catch(() => undefined);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.parentElement?.contains(e.target as Node)) {
        closeRef.current();
      }
    };
    if (isOpen) {
      const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
      const trigger = menuRef.current?.parentElement?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleOutsideClick);
        document.removeEventListener('keydown', handleEscape);
        trigger?.focus();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isOwner = aiStatus?.isOwner;

  return (
    <div
      ref={menuRef}
      id="account-menu"
      role="menu"
      aria-label="Account menu"
      className={`absolute z-[60] w-72 max-w-[calc(100vw-1rem)] max-h-[min(75dvh,650px)] overflow-y-auto rounded-2xl border theme-border theme-card p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-150 ${placement === 'top' ? 'right-0 top-full mt-1' : 'bottom-full left-0 mb-2'}`}
      style={{ backgroundColor: 'var(--card-bg)' }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      {/* Header: User identity */}
      <button
        type="button"
        onClick={() => {
          setCurrentView('profile');
          onClose();
        }}
        className="flex min-h-11 w-full items-center gap-3 p-2 rounded-xl text-left theme-hover transition-colors"
      >
        <UserAvatar profile={profile} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-theme-primary truncate">{profile.name}</p>
          <p className="text-xs text-theme-tertiary truncate">{profile.email || 'Guest User'}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-theme-tertiary shrink-0" />
      </button>

      {/* Sync indicator */}
      <div className="mx-1 my-1.5 flex items-center justify-between px-2 py-1.5 rounded-lg bg-[var(--app-bg-subtle)] text-xs">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-[11px] font-medium text-theme-secondary">
            {syncing ? 'Syncing…' : online ? 'Cloud Sync Active' : 'Offline Mode'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void manualSync()}
          disabled={syncing || !online}
          className="text-[11px] font-bold accent-text hover:underline disabled:opacity-40"
        >
          {syncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Sync now'}
        </button>
      </div>

      <div className="h-px theme-divider my-1" />

      {/* Primary Account Action: View Profile */}
      <div className="space-y-0.5">
        <button
          type="button"
          onClick={() => {
            setCurrentView('profile');
            onClose();
          }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-theme-secondary theme-hover transition-colors"
        >
          <User className="w-4 h-4 text-theme-tertiary" />
          <span className="flex-1 text-left">View Profile</span>
        </button>

        <button type="button" onClick={() => { setCurrentView('settings'); onClose(); }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-theme-secondary theme-hover">
          <Settings className="w-4 h-4 text-theme-tertiary" />Settings
        </button>
        <button type="button" onClick={() => { setTheme(resolveThemeMode(settings.theme) === 'light' ? 'dark' : 'light'); }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-theme-secondary theme-hover"
          aria-label={resolveThemeMode(settings.theme) === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
          {resolveThemeMode(settings.theme) === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          {resolveThemeMode(settings.theme) === 'light' ? 'Dark Mode' : 'Light Mode'}
        </button>
        <button type="button" onClick={() => { setCommandPaletteOpen(true); onClose(); }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-theme-secondary theme-hover">
          <CircleHelp className="w-4 h-4 text-theme-tertiary" />Help & Shortcuts
        </button>

        <button
          type="button"
          onClick={() => {
            setSyncCenterOpen(true);
            onClose();
          }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-theme-secondary theme-hover transition-colors"
        >
          <ShieldCheck className="w-4 h-4 accent-text" />
          <span className="flex-1 text-left">Sync & Offline Status</span>
        </button>
      </div>

      {/* Owner Console (Only for verified owners, per Addendum G) */}
      {isOwner && (
        <>
          <div className="h-px theme-divider my-1.5" />
          <div className="px-2 py-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1">
              <Shield className="w-3 h-3" />
              Owner Console
            </p>
            <button
              type="button"
              onClick={() => {
                openSettings('owner');
                onClose();
              }}
              className="flex min-h-11 w-full items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs font-medium hover:bg-amber-500/20 transition-colors"
            >
              <span>Manage AI & Storage</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      <div className="h-px theme-divider my-1.5" />

      {/* Sign in with Google or Sign out */}
      {profile.email ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            void signOut(auth).then(() => {
              const coord = getTabCoordinator();
              coord.broadcast({
                type: 'auth_signout',
                senderId: coord.tabId,
                timestamp: Date.now(),
                payload: { email: profile.email },
              });
              clearAuth();
            }).catch(console.error);
          }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={async () => {
            onClose();
            try {
              await signInWithPopup(auth, googleProvider);
            } catch (err) {
              console.error('Sign in with Google failed:', err);
            }
          }}
          className="flex min-h-11 w-full items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-theme-primary bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          <span>Sign in with Google</span>
        </button>
      )}
    </div>
  );
}
