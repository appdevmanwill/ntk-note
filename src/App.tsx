import { useEffect } from 'react';
import { useStore } from '@/store';
import Onboarding from '@/components/Onboarding';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import NoteList from '@/components/NoteList';
import NoteEditor from '@/components/NoteEditor';
import TemplatesView from '@/components/TemplatesView';
import SettingsView from '@/components/SettingsView';
import GraphView from '@/components/GraphView';
import SmartFoldersView from '@/components/SmartFoldersView';
import ShareCenterView from '@/components/ShareCenterView';
import NotificationsView from '@/components/NotificationsView';
import CommandPalette from '@/components/CommandPalette';
import MobileNav from '@/components/MobileNav';
import PublicNoteReader from '@/components/PublicNoteReader';
import OnboardingGuide from '@/components/OnboardingGuide';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import { accentPalette } from '@/utils/noteThemes';
import { getHolidaysForDate } from '@/utils/holidays';
import type { AppNotification, AppSettings, SidebarView } from '@/types';
import {
  FileText, PanelLeftOpen, PanelRightOpen,
} from 'lucide-react';

const darkAccentPalette: typeof accentPalette = {
  indigo: { primary: '#2563eb', hover: '#1e40af', rgb: '37, 99, 235' },
  blue: { primary: '#0ea5e9', hover: '#0369a1', rgb: '14, 165, 233' },
  purple: { primary: '#7c3aed', hover: '#5b21b6', rgb: '124, 58, 237' },
  pink: { primary: '#f472b6', hover: '#f9a8d4', rgb: '244, 114, 182' },
  red: { primary: '#f87171', hover: '#fca5a5', rgb: '248, 113, 113' },
  orange: { primary: '#fb923c', hover: '#fdba74', rgb: '251, 146, 60' },
  amber: { primary: '#fbbf24', hover: '#fcd34d', rgb: '251, 191, 36' },
  emerald: { primary: '#34d399', hover: '#6ee7b7', rgb: '52, 211, 153' },
  teal: { primary: '#2dd4bf', hover: '#5eead4', rgb: '45, 212, 191' },
  cyan: { primary: '#22d3ee', hover: '#67e8f9', rgb: '34, 211, 238' },
  violet: { primary: '#a78bfa', hover: '#c4b5fd', rgb: '167, 139, 250' },
  rose: { primary: '#fb7185', hover: '#fda4af', rgb: '251, 113, 133' },
};

const NOTIFICATION_ICON = '/ntk-icon-192.png';

const parseClockMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const isQuietTime = (settings: AppSettings, date = new Date()) => {
  if (!settings.quietHoursEnabled) return false;

  const start = parseClockMinutes(settings.quietHoursStart);
  const end = parseClockMinutes(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return false;

  const current = date.getHours() * 60 + date.getMinutes();
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
};

const localDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const slugifyNotificationId = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70);

export default function App() {
  const {
    isOnboarded, settings, currentView, selectedNoteId,
    editingNote, setCommandPaletteOpen, completeOnboarding
  } = useStore();

  const toggleNoteListCollapse = () => {
    const state = useStore.getState();
    const next = !state.settings.noteListCollapsed;
    state.updateSettings({
      noteListCollapsed: next,
      editorPanelCollapsed: next ? false : state.settings.editorPanelCollapsed,
    });
  };

  const toggleEditorPanelCollapse = () => {
    const state = useStore.getState();
    const next = !state.settings.editorPanelCollapsed;
    state.updateSettings({
      editorPanelCollapsed: next,
      noteListCollapsed: next ? false : state.settings.noteListCollapsed,
    });
  };

  const showBrowserNotification = async (notification: AppNotification) => {
    const state = useStore.getState();
    if (!state.settings.notificationsEnabled || !state.settings.browserNotificationsEnabled) return false;
    if (isQuietTime(state.settings)) return false;
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;

    const options: NotificationOptions = {
      body: notification.message,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      tag: notification.id,
      data: {
        notificationId: notification.id,
        action: notification.action,
        noteId: notification.noteId,
      },
    };

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(notification.title, options);
        state.recordNotificationDelivery(notification.id);
        return true;
      }
    }

    new Notification(notification.title, options);
    state.recordNotificationDelivery(notification.id);
    return true;
  };

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        completeOnboarding(user.displayName || 'User', user.email || '');
        // Also we can call an initFirestore function here to bind onSnapshot
        useStore.getState().initFirestore(user.uid);
      } else {
        const state = useStore.getState();
        if (state.uid) {
          state.clearAuth();
        }
      }
    });
    return () => unsubscribe();
  }, [completeOnboarding]);

  useEffect(() => {
    const updateOnlineStatus = () => {
      useStore.getState().setOnlineStatus(navigator.onLine);
    };
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (settings.offlineModeEnabled || settings.browserNotificationsEnabled) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => registration.update())
        .catch(error => {
          console.warn('Service worker registration failed:', error);
        });
      return;
    }

    navigator.serviceWorker.getRegistrations()
      .then(registrations => registrations
        .filter(registration => {
          const scriptUrl = registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || '';
          return scriptUrl.endsWith('/sw.js');
        })
        .forEach(registration => registration.unregister()))
      .catch(error => console.warn('Service worker cleanup failed:', error));
  }, [settings.offlineModeEnabled, settings.browserNotificationsEnabled]);

  // Apply theme — belt-and-suspenders approach
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const accent = settings.theme === 'dark'
      ? darkAccentPalette[settings.accent] || darkAccentPalette.indigo
      : accentPalette[settings.accent] || accentPalette.indigo;
    root.style.setProperty('--accent-primary', accent.primary);
    root.style.setProperty('--accent-primary-hover', accent.hover);
    root.style.setProperty('--accent-rgb', accent.rgb);
    root.style.setProperty('--active-bg', `rgba(${accent.rgb}, ${settings.theme === 'dark' ? '0.18' : '0.11'})`);
    root.style.setProperty('--accent-glow', `rgba(${accent.rgb}, ${settings.theme === 'dark' ? '0.22' : '0.14'})`);
    root.style.setProperty('--badge-bg', `rgba(${accent.rgb}, ${settings.theme === 'dark' ? '0.18' : '0.09'})`);
    root.style.setProperty('--badge-text', accent.hover);

    if (settings.theme === 'dark') {
      root.classList.add('dark');
      body.classList.add('dark');
      body.style.backgroundColor = '#071528';
      body.style.color = '#eef6ff';
      themeMeta?.setAttribute('content', '#071528');
    } else {
      root.classList.remove('dark');
      body.classList.remove('dark');
      body.style.backgroundColor = '#f5f7fa';
      body.style.color = '#18202b';
      themeMeta?.setAttribute('content', '#f5f7fa');
    }
  }, [settings.theme, settings.accent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+N: New note
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        useStore.getState().createNote({});
      }
      // Ctrl+/: Command palette
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      // Ctrl+\: Toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        if (window.innerWidth >= 1024) {
          const state = useStore.getState();
          state.updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed });
        } else {
          useStore.getState().setSidebarOpen(!useStore.getState().sidebarOpen);
        }
      }
      // Ctrl+Alt+L: Toggle notes list panel
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const state = useStore.getState();
        const next = !state.settings.noteListCollapsed;
        state.updateSettings({
          noteListCollapsed: next,
          editorPanelCollapsed: next ? false : state.settings.editorPanelCollapsed,
        });
      }
      // Ctrl+Alt+P: Toggle editor/preview panel
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const state = useStore.getState();
        const next = !state.settings.editorPanelCollapsed;
        state.updateSettings({
          editorPanelCollapsed: next,
          noteListCollapsed: next ? false : state.settings.noteListCollapsed,
        });
      }
      // Escape: Close editor
      if (e.key === 'Escape') {
        if (useStore.getState().settings.zenMode) {
          useStore.getState().toggleZenMode();
        } else if (useStore.getState().editingNote) {
          useStore.getState().selectNote(null);
          useStore.getState().setEditingNote(false);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Reminder notifications
  useEffect(() => {
    const checkReminders = () => {
      const state = useStore.getState();
      const currentTime = new Date().getTime();
      state.notes.forEach(note => {
        if (note.reminder && !note.reminder.triggered && !note.trashed) {
          const reminderTime = new Date(note.reminder.time).getTime();
          if (currentTime >= reminderTime) {
            if (state.settings.notificationsEnabled && state.settings.reminderNotificationsEnabled) {
              const notificationId = `note-reminder-${note.id}-${note.reminder.id || note.reminder.time}`;
              const existing = state.notifications.find(notification => notification.id === notificationId);
              const notification = existing || state.addNotification({
                id: notificationId,
                type: 'note-reminder',
                title: note.reminder.title || 'Note reminder',
                message: note.title ? `Reminder for "${note.title}"` : 'A note reminder is due.',
                dueAt: note.reminder.time,
                noteId: note.id,
                action: 'open-note',
                priority: 'high',
              });

              if (!notification.dismissedAt && !notification.lastDeliveredAt) {
                void showBrowserNotification(notification)
                  .catch(error => console.warn('Reminder notification failed:', error));
              }
            }
            state.setNoteReminder(note.id, { ...note.reminder, triggered: true });
          }
        }
      });
    };

    const interval = setInterval(checkReminders, 30000);
    checkReminders();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkCelebrations = () => {
      const state = useStore.getState();
      if (!state.settings.notificationsEnabled || !state.settings.celebrationNotificationsEnabled) return;

      const currentDate = new Date();
      const reminderMinutes = parseClockMinutes(state.settings.celebrationReminderTime) ?? 8 * 60;
      const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
      if (currentMinutes < reminderMinutes) return;

      const dateKey = localDateKey(currentDate);
      getHolidaysForDate(currentDate).forEach((holiday, index) => {
        const notificationId = `celebration-${dateKey}-${holiday.type}-${slugifyNotificationId(holiday.name)}-${index}`;
        const existing = state.notifications.find(notification => notification.id === notificationId);
        if (existing) return;

        const notification = state.addNotification({
          id: notificationId,
          type: 'celebration',
          title: `Today: ${holiday.name}`,
          message: holiday.summary,
          dueAt: currentDate.toISOString(),
          action: 'open-calendar',
          priority: holiday.type === 'BCG' ? 'high' : 'normal',
          metadata: {
            calendarType: holiday.type,
            dateKey,
          },
        });

        void showBrowserNotification(notification)
          .catch(error => console.warn('Celebration notification failed:', error));
      });
    };

    const interval = setInterval(checkCelebrations, 60000);
    checkCelebrations();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const checkSnoozedNotifications = () => {
      const state = useStore.getState();
      const currentTime = Date.now();

      state.notifications.forEach(notification => {
        if (notification.dismissedAt || !notification.snoozedUntil) return;
        const snoozedUntil = new Date(notification.snoozedUntil).getTime();
        if (!Number.isFinite(snoozedUntil) || snoozedUntil > currentTime) return;

        const lastDeliveredAt = notification.lastDeliveredAt
          ? new Date(notification.lastDeliveredAt).getTime()
          : 0;
        if (lastDeliveredAt >= snoozedUntil) return;

        void showBrowserNotification(notification)
          .catch(error => console.warn('Snoozed notification failed:', error));
      });
    };

    const interval = setInterval(checkSnoozedNotifications, 30000);
    checkSnoozedNotifications();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const createCollaborationNotifications = () => {
      const state = useStore.getState();
      if (!state.settings.notificationsEnabled || !state.settings.collaborationNotificationsEnabled) return;

      const currentUserEmail = auth.currentUser?.email?.toLowerCase() || '';
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;

      state.activityItems.forEach(activity => {
        const activityTime = new Date(activity.createdAt).getTime();
        if (!Number.isFinite(activityTime) || activityTime < cutoff) return;
        if (currentUserEmail && activity.actorEmail.toLowerCase() === currentUserEmail) return;

        const notificationId = `activity-${activity.id}`;
        if (state.notifications.some(notification => notification.id === notificationId)) return;

        state.addNotification({
          id: notificationId,
          type: 'shared-activity',
          title: activity.actorName || activity.actorEmail || 'Shared activity',
          message: activity.message,
          dueAt: activity.createdAt,
          noteId: activity.noteId,
          entityId: activity.entityId,
          action: activity.noteId ? 'open-note' : 'open-share-center',
          priority: 'normal',
          metadata: {
            entityType: activity.entityType,
            action: activity.action,
          },
        });
      });
    };

    const unsubscribe = useStore.subscribe(createCollaborationNotifications);
    createCollaborationNotifications();
    return () => unsubscribe();
  }, []);

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const publicNoteId = params?.get('p') || params?.get('sharedNoteId');

  if (publicNoteId) {
    return <PublicNoteReader noteId={publicNoteId} />;
  }

  if (!isOnboarded) {
    return <Onboarding />;
  }

  // Determine main content
  const renderMainContent = () => {
    const splitViews: SidebarView[] = ['all-notes', 'search', 'starred', 'reminders', 'archived', 'trash', 'notebooks', 'tags'];
    const noteListCollapsed = settings.noteListCollapsed;
    const editorPanelCollapsed = settings.editorPanelCollapsed;

    // Notes opened from dashboard/templates stay full-screen. List views keep the desktop side panel.
    if (editingNote && selectedNoteId && !splitViews.includes(currentView)) {
      return <NoteEditor />;
    }

    switch (currentView) {
      case 'home':
        return <Dashboard />;
      case 'templates':
        return <TemplatesView />;
      case 'settings':
        return <SettingsView />;
      case 'graph':
        return <GraphView />;
      case 'smart-folders':
        return <SmartFoldersView />;
      case 'shared':
        return <ShareCenterView />;
      case 'notifications':
        return <NotificationsView />;
      case 'all-notes':
      case 'search':
      case 'starred':
      case 'reminders':
      case 'archived':
      case 'trash':
      case 'notebooks':
      case 'tags':
        return (
          <div className="flex flex-1 overflow-hidden">
            {noteListCollapsed && (
              <CollapsedPanelRail
                side="left"
                label="Show notes list"
                icon={PanelLeftOpen}
                onClick={toggleNoteListCollapse}
              />
            )}
            <div className={`
              ${editingNote && selectedNoteId ? 'hidden xl:flex' : 'flex'}
              ${noteListCollapsed ? 'xl:hidden' : 'xl:flex'}
              flex-1 min-w-0
            `}>
              <NoteList onCollapsePanel={toggleNoteListCollapse} />
            </div>
            <div className={`
              ${editingNote && selectedNoteId ? 'flex' : 'hidden xl:flex'}
              ${editorPanelCollapsed ? 'xl:hidden' : 'xl:flex'}
              flex-1 min-w-0 xl:border-l theme-divider
            `}>
              <NoteEditor onCollapsePanel={toggleEditorPanelCollapse} />
            </div>
            {editorPanelCollapsed && (
              <CollapsedPanelRail
                side="right"
                label="Show editor panel"
                icon={selectedNoteId ? PanelRightOpen : FileText}
                onClick={toggleEditorPanelCollapse}
              />
            )}
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className={`min-h-dvh h-full flex theme-bg text-theme-primary ${settings.zenMode ? '' : ''}`} data-density={settings.density}>
      {/* Sidebar — hidden in zen mode */}
      {!settings.zenMode && <Sidebar />}

      {/* Main area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {renderMainContent()}
      </main>

      {/* Mobile bottom nav */}
      {!settings.zenMode && <MobileNav />}

      {/* Command palette */}
      <CommandPalette />

      {/* Onboarding */}
      <OnboardingGuide />
    </div>
  );
}

function CollapsedPanelRail({
  side,
  label,
  icon: Icon,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  icon: typeof PanelLeftOpen;
  onClick: () => void;
}) {
  return (
    <div
      className={`
        hidden xl:flex w-12 shrink-0 items-start justify-center border-r theme-divider
        ${side === 'right' ? 'border-r-0 border-l' : ''}
      `}
      style={{ backgroundColor: 'var(--app-bg-subtle)' }}
    >
      <button
        type="button"
        onClick={onClick}
        className="mt-4 p-2 rounded-xl theme-hover text-theme-tertiary"
        title={label}
        aria-label={label}
      >
        <Icon className="w-5 h-5 no-transition" />
      </button>
    </div>
  );
}
