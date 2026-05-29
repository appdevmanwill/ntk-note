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
import CommandPalette from '@/components/CommandPalette';
import MobileNav from '@/components/MobileNav';
import PublicNoteReader from '@/components/PublicNoteReader';
import OnboardingGuide from '@/components/OnboardingGuide';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import { accentPalette } from '@/utils/noteThemes';
import type { SidebarView } from '@/types';
import {
  FileText, PanelLeftOpen, PanelRightOpen,
} from 'lucide-react';

const darkAccentPalette: typeof accentPalette = {
  indigo: { primary: '#818cf8', hover: '#a5b4fc', rgb: '129, 140, 248' },
  blue: { primary: '#60a5fa', hover: '#93c5fd', rgb: '96, 165, 250' },
  purple: { primary: '#c084fc', hover: '#d8b4fe', rgb: '192, 132, 252' },
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

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        completeOnboarding(user.displayName || 'User', user.email || '');
        // Also we can call an initFirestore function here to bind onSnapshot
        useStore.getState().initFirestore(user.uid);
      } else {
        useStore.getState().clearAuth();
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

    if (settings.offlineModeEnabled) {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => registration.update())
        .catch(error => {
          console.warn('Offline mode registration failed:', error);
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
      .catch(error => console.warn('Offline mode cleanup failed:', error));
  }, [settings.offlineModeEnabled]);

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
      body.style.backgroundColor = '#111315';
      body.style.color = '#f1f4f7';
      themeMeta?.setAttribute('content', '#111315');
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
      const now = new Date().getTime();
      state.notes.forEach(note => {
        if (note.reminder && !note.reminder.triggered && !note.trashed) {
          const reminderTime = new Date(note.reminder.time).getTime();
          if (now >= reminderTime) {
            // Trigger notification
            if ('Notification' in window && Notification.permission === 'granted') {
              if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(registration => {
                  registration.showNotification('NTK Note Reminder', {
                    body: note.reminder.title || note.title || 'You have a reminder',
                    icon: '/ntk-icon.svg',
                    badge: '/ntk-icon.svg',
                    vibrate: [200, 100, 200],
                    tag: `reminder-${note.id}`,
                  });
                });
              } else {
                new Notification('NTK Note Reminder', {
                  body: note.reminder.title || note.title || 'You have a reminder',
                  icon: '/ntk-icon.svg',
                });
              }
            }
            state.setNoteReminder(note.id, { ...note.reminder, triggered: true });
          }
        }
      });
    };
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    const interval = setInterval(checkReminders, 30000);
    checkReminders();
    return () => clearInterval(interval);
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
    const splitViews: SidebarView[] = ['all-notes', 'search', 'starred', 'reminders', 'archived', 'trash', 'notebooks', 'tags', 'shared'];
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
      case 'all-notes':
      case 'search':
      case 'starred':
      case 'reminders':
      case 'archived':
      case 'trash':
      case 'notebooks':
      case 'tags':
      case 'shared':
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
              ${editingNote && selectedNoteId ? 'hidden lg:flex' : 'flex'}
              ${noteListCollapsed ? 'lg:hidden' : 'lg:flex'}
              flex-1 min-w-0
            `}>
              <NoteList onCollapsePanel={toggleNoteListCollapse} />
            </div>
            <div className={`
              ${editingNote && selectedNoteId ? 'flex' : 'hidden lg:flex'}
              ${editorPanelCollapsed ? 'lg:hidden' : 'lg:flex'}
              flex-1 min-w-0 lg:border-l theme-divider
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
        hidden lg:flex w-12 shrink-0 items-start justify-center border-r theme-divider
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
