import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import Onboarding from '@/components/Onboarding';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import Dashboard from '@/components/Dashboard';
import NoteList from '@/components/NoteList';
import NoteEditor from '@/components/NoteEditor';
import TemplatesView from '@/components/TemplatesView';
import SettingsView from '@/components/SettingsView';
import GraphView from '@/components/GraphView';
import SmartFoldersView from '@/components/SmartFoldersView';
import ShareCenterView from '@/components/ShareCenterView';
import NotificationsView from '@/components/NotificationsView';
import RemindersCenterView from '@/components/RemindersCenterView';
import FoldersView from '@/components/FoldersView';
import MoreView from '@/components/MoreView';
import CommandPalette from '@/components/CommandPalette';
import MobileNav from '@/components/MobileNav';
import PublicNoteReader from '@/components/PublicNoteReader';
import OnboardingGuide from '@/components/OnboardingGuide';
import AiAssistantView from '@/components/AiAssistantView';
import MessagesView from '@/components/MessagesView';
import MyProfileView from '@/components/MyProfileView';
import SyncOfflineCenterModal from '@/components/SyncOfflineCenterModal';
import ConflictResolutionModal from '@/components/ConflictResolutionModal';
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt';
import { getTabCoordinator, type TabMessage } from '@/utils/tabCoordinator';
import { recordStartupComplete } from '@/utils/performanceMetrics';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import { retryPendingMediaCleanups } from '@/utils/pendingMediaCleanupQueue';
import { retryPendingReminderCleanups } from '@/utils/recycleBinService';
import { setCurrentSpeechUser } from '@/utils/ntkAi';
import { getOfflineMediaSyncService } from '@/utils/offlineMediaSyncService';
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
    editingNote, setCommandPaletteOpen, sidebarOpen, syncMessage,
    syncCenterOpen, setSyncCenterOpen, syncConflicts, resolveSyncConflict,
    conflictRecoveryNotice, dismissConflictRecoveryNotice, selectNote
  } = useStore();

  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isUpdatingSw, setIsUpdatingSw] = useState(false);

  useEffect(() => {
    recordStartupComplete();
  }, []);

  // Conflicts require an explicit user decision. Never silently fork notes.

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
      setCurrentSpeechUser(user ? user.uid : null);
      getOfflineMediaSyncService().setActiveUser(user ? user.uid : null);
      const state = useStore.getState();
      const nextUid = user ? user.uid : null;

      // IMMEDIATE SYNCHRONOUS INVALIDATION OF VOLATILE ACCOUNT-BOUND UI/STATE
      // Before B's workspace hydration becomes usable, ensure A's volatile state cannot linger.
      if (state.uid && state.uid !== nextUid) {
        state.clearAuth();
      }

      if (user) {
        try {
          // IMPORTANT: switch to the authenticated user's workspace first.
          // Completing onboarding before initFirestore() writes the flag/profile
          // into the guest namespace; initFirestore() then loads the user's
          // (often false) onboarded flag and can leave the login screen spinning.
          void state.initFirestore(user.uid).then(() => {
            useStore.getState().completeOnboarding(
              user.isAnonymous
                ? 'Guest'
                : (user.displayName || useStore.getState().profile.name || 'User'),
              user.email || '',
              user.isAnonymous ? 'builtin:aurora' : (user.photoURL || undefined)
            );

            // Process notification deep-link params after auth + store are ready.
            processDeepLink();

            // Section 7: Bounded pending media and reminder cleanup retry on authenticated startup
            if (!user.isAnonymous && user.uid) {
              void retryPendingMediaCleanups(user.uid).catch(() => 0);
              void retryPendingReminderCleanups(user.uid).catch(() => 0);
            }
          }).catch(error => {
            console.error('Authenticated session initialization failed:', error);
          });
        } catch (error) {
          console.error('Authenticated session initialization failed:', error);
        }
      } else {
        const state = useStore.getState();
        if (state.uid) {
          state.clearAuth();
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // ── Notification deep-link handler ──
  // Reads ?action=...&noteId=...&reminderId=... from the URL (set by the service worker's
  // notificationclick handler) and dispatches the correct navigation action with hydration resolution.
  const processDeepLink = () => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const noteId = params.get('noteId');
    const reminderId = params.get('reminderId');

    if (!action) return;

    // Clean the URL immediately to avoid re-processing on refresh
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    // State-driven hydration: wait for store/notes to hydrate (up to 2.5s)
    let attempts = 0;
    const maxAttempts = 25;

    const dispatchAction = () => {
      attempts++;
      const store = useStore.getState();
      const isHydrated = store.notes.length > 0 || !store.uid || attempts >= maxAttempts;

      if (!isHydrated) {
        setTimeout(dispatchAction, 100);
        return;
      }

      if (action === 'open-note' && noteId) {
        const targetNote = store.notes.find(n => n.id === noteId);
        store.selectNote(noteId);
        store.setEditingNote(true);
        if (targetNote?.isShared && targetNote.ownerId !== store.uid) {
          store.setCurrentView('shared');
        } else {
          store.setCurrentView('all-notes');
        }
      } else if (action === 'open-reminder') {
        store.setCurrentView('reminders');
        if (reminderId) {
          const targetReminder = store.reminders.find(r => r.id === reminderId);
          if (targetReminder?.noteId) {
            store.selectNote(targetReminder.noteId);
          }
        }
      } else if (action === 'open-share-center') {
        store.setCurrentView('shared');
      } else if (action === 'open-settings') {
        store.setCurrentView('settings');
      } else if (action === 'open-trash') {
        store.setCurrentView('trash');
      } else if (action === 'open-calendar') {
        store.setCurrentView('home');
      }
    };

    setTimeout(dispatchAction, 150);
  };

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

  // Tablet landscape (1024–1279) uses the compact navigation rail; full sidebar from 1280 up.
  // Crossing back above the mobile breakpoint also closes a stale open drawer
  // so the desktop shell is never left inert.
  useEffect(() => {
    const desktopMedia = window.matchMedia('(min-width: 1280px)');
    const drawerMedia = window.matchMedia('(min-width: 1024px)');
    const closeDrawerIfOpen = () => {
      if (drawerMedia.matches && useStore.getState().sidebarOpen) {
        useStore.getState().setSidebarOpen(false);
      }
    };
    const syncSidebarWidth = () => {
      const state = useStore.getState();
      const shouldCollapse = !desktopMedia.matches;
      if (state.settings.sidebarCollapsed !== shouldCollapse) {
        state.updateSettings({ sidebarCollapsed: shouldCollapse });
      }
    };
    syncSidebarWidth();
    closeDrawerIfOpen();
    desktopMedia.addEventListener('change', syncSidebarWidth);
    drawerMedia.addEventListener('change', closeDrawerIfOpen);
    return () => {
      desktopMedia.removeEventListener('change', syncSidebarWidth);
      drawerMedia.removeEventListener('change', closeDrawerIfOpen);
    };
  }, []);

  useEffect(() => {
    const coordinator = getTabCoordinator();
    coordinator.start();

    const handleTabMessage = (msg: TabMessage) => {
      if (msg.type === 'auth_signout') {
        useStore.getState().clearAuth();
      }
    };

    coordinator.addMessageListener(handleTabMessage);

    return () => {
      coordinator.removeMessageListener(handleTabMessage);
      coordinator.stop();
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!('serviceWorker' in navigator)) return;

    const handleRegistration = (registration: ServiceWorkerRegistration) => {
      setSwRegistration(registration);

      if (registration.waiting) {
        setShowUpdatePrompt(true);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setShowUpdatePrompt(true);
          }
        });
      });
    };

    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        handleRegistration(registration);
        void registration.update();
      })
      .catch(error => console.warn('Service worker registration failed:', error));

    let refreshing = false;
    const onControllerChange = () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const handleSwUpdateNow = () => {
    if (!swRegistration?.waiting) return;
    setIsUpdatingSw(true);
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  // Apply theme — belt-and-suspenders approach.
  // 'system' follows the OS preference and reacts to changes live.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const systemMedia = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const resolved = settings.theme === 'system'
        ? (systemMedia.matches ? 'dark' : 'light')
        : settings.theme;
      const accent = resolved === 'dark'
        ? darkAccentPalette[settings.accent] || darkAccentPalette.indigo
        : accentPalette[settings.accent] || accentPalette.indigo;
      root.style.setProperty('--accent-primary', accent.primary);
      root.style.setProperty('--accent-primary-hover', accent.hover);
      root.style.setProperty('--accent-rgb', accent.rgb);
      root.style.setProperty('--active-bg', `rgba(${accent.rgb}, ${resolved === 'dark' ? '0.18' : '0.11'})`);
      root.style.setProperty('--accent-glow', `rgba(${accent.rgb}, ${resolved === 'dark' ? '0.22' : '0.14'})`);
      root.style.setProperty('--badge-bg', `rgba(${accent.rgb}, ${resolved === 'dark' ? '0.18' : '0.09'})`);
      root.style.setProperty('--badge-text', accent.hover);

      if (resolved === 'dark') {
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
    };

    applyTheme();

    if (settings.theme === 'system') {
      systemMedia.addEventListener('change', applyTheme);
      return () => systemMedia.removeEventListener('change', applyTheme);
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

  // ── Device-local reminder delivery helpers ──
  // Keeps reminder alerts deduplicated on THIS device without cloud-syncing
  // delivery flags that would suppress alerts on other signed-in devices.
  const getLocalDeliveryKey = (uid: string | null) => `${uid ? `ntk:user:${uid}` : 'ntk:guest'}:reminder-delivery`;

  const getLocalDeliveryLedger = (uid: string | null): Record<string, string> => {
    try {
      const raw = localStorage.getItem(getLocalDeliveryKey(uid));
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const recordLocalDelivery = (uid: string | null, reminderId: string, occurrence: string) => {
    try {
      const ledger = getLocalDeliveryLedger(uid);
      ledger[reminderId] = occurrence;
      localStorage.setItem(getLocalDeliveryKey(uid), JSON.stringify(ledger));
    } catch {}
  };

  // Reminder notifications (Device-Local delivery)
  useEffect(() => {
    const checkReminders = () => {
      const state = useStore.getState();
      const currentTime = new Date().getTime();
      const deliveryLedger = getLocalDeliveryLedger(state.uid);

      // Check all active reminders in the store
      const activeReminders = state.reminders.filter(r => r.status === 'active');
      activeReminders.forEach(reminder => {
        const dueTime = new Date(reminder.snoozedUntil || reminder.dueAt).getTime();
        const currentOccurrence = `${reminder.snoozedUntil || reminder.dueAt}_${reminder.status}`;

        if (Number.isFinite(dueTime) && currentTime >= dueTime) {
          // If already delivered on this device for this occurrence, do not re-alert
          if (deliveryLedger[reminder.id] === currentOccurrence) {
            return;
          }

          if (state.settings.notificationsEnabled && state.settings.reminderNotificationsEnabled) {
            const notificationId = `reminder-${reminder.id}`;
            const notification = state.addNotification({
              id: notificationId,
              type: 'note-reminder',
              title: reminder.title || 'Reminder due',
              message: reminder.details || (reminder.noteId ? 'A note reminder is due.' : 'A scheduled reminder is due.'),
              dueAt: reminder.dueAt,
              noteId: reminder.noteId,
              entityId: reminder.id,
              action: reminder.noteId ? 'open-note' : 'open-reminder',
              priority: reminder.priority === 'urgent' || reminder.priority === 'high' ? 'high' : reminder.priority === 'low' ? 'low' : 'normal',
            });

            void showBrowserNotification(notification)
              .catch(error => console.warn('Reminder notification failed:', error));
          }

          // Record in device-local ledger ONLY — DO NOT sync triggered to Firestore
          recordLocalDelivery(state.uid, reminder.id, currentOccurrence);
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
    const splitViews: SidebarView[] = ['all-notes', 'search', 'starred', 'archived', 'trash', 'notebooks', 'tags'];
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
      case 'ai':
        return <AiAssistantView />;
      case 'messages':
        return <MessagesView />;
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
      case 'reminders':
        return <RemindersCenterView />;
      case 'folders':
        return <FoldersView />;
      case 'more':
        return <MoreView />;
      case 'profile':
        return <MyProfileView />;
      case 'all-notes':
      case 'search':
      case 'starred':
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
              ${editingNote && selectedNoteId ? 'hidden 2xl:flex' : 'flex'}
              ${noteListCollapsed ? '2xl:hidden' : '2xl:flex'}
              flex-1 min-w-0
            `}>
              <NoteList onCollapsePanel={toggleNoteListCollapse} />
            </div>
            <div className={`
              ${editingNote && selectedNoteId ? 'flex' : 'hidden 2xl:flex'}
              ${editorPanelCollapsed ? '2xl:hidden' : '2xl:flex'}
              flex-1 min-w-0 2xl:border-l theme-divider
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
    <div className={`h-dvh overflow-hidden flex theme-bg text-theme-primary`} data-density={settings.density}>
      {/* Sidebar — hidden in zen mode */}
      {!settings.zenMode && <Sidebar />}

      {/* Main area — inert while the mobile navigation drawer is open */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden" inert={sidebarOpen || undefined}>
        {!settings.zenMode && <TopBar />}
        {renderMainContent()}
      </main>

      {/* Mobile bottom nav */}
      {!settings.zenMode && <MobileNav />}

      {/* Command palette */}
      <CommandPalette />

      {/* Onboarding */}
      <OnboardingGuide />

      {/* Sync & Offline Center Modal */}
      <SyncOfflineCenterModal
        isOpen={syncCenterOpen}
        onClose={() => setSyncCenterOpen(false)}
        onOpenConflictResolver={() => {
          setSyncCenterOpen(false);
        }}
      />

      {/* Novice-First Safe Conflict Recovery Notification */}
      {(conflictRecoveryNotice || syncConflicts.length > 0) && (
        <ConflictResolutionModal
          isOpen={true}
          notice={conflictRecoveryNotice}
          conflict={syncConflicts[0] || null}
          onClose={() => {
            dismissConflictRecoveryNotice();
          }}
          onViewCanonicalNote={(canonicalId) => {
            selectNote(canonicalId);
          }}
          onResolve={(strategy) => {
            if (syncConflicts[0]) {
              void resolveSyncConflict(syncConflicts[0].id, strategy);
            }
          }}
        />
      )}

      {/* PWA Update Prompt */}
      <PwaUpdatePrompt
        show={showUpdatePrompt}
        onUpdateNow={handleSwUpdateNow}
        onLater={() => setShowUpdatePrompt(false)}
        isUpdating={isUpdatingSw}
      />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {syncMessage}
      </p>
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
