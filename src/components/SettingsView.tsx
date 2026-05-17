import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/store';
import type { NoteTheme, ThemeAccent } from '@/types';
import { accentColors } from '@/utils/colors';
import { noteThemes } from '@/utils/noteThemes';
import { premiumFontFamilies } from '@/utils/fonts';
import {
  User, Palette, Type, Download, Upload,
  Trash2, Moon, Sun, Keyboard, Info,
  ChevronRight, FolderInput, ShieldCheck, Wifi, DownloadCloud,
  AlertTriangle, RefreshCw
} from 'lucide-react';
import ImportManager from './ImportManager';
import QuotaDashboard from './QuotaDashboard';
import BrandMark from './BrandMark';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function SettingsView() {
  const {
    profile, setProfile, settings, updateSettings, setTheme, setAccent,
    exportAllNotes, importNotes, resetApp, getStats,
    syncConflicts, resolveSyncConflict, online,
  } = useStore();

  const [activeSection, setActiveSection] = useState('profile');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showImportManager, setShowImportManager] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState('');
  const [offlineStatus, setOfflineStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats = getStats();

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage('Install prompt is ready.');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    const refreshOfflineStatus = async () => {
      if (!('serviceWorker' in navigator)) {
        setOfflineStatus('Offline app cache is not supported in this browser.');
        return;
      }
      const registrations = await navigator.serviceWorker.getRegistrations();
      const hasNtkWorker = registrations.some(registration => {
        const scriptUrl = registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || '';
        return scriptUrl.endsWith('/sw.js');
      });
      if (hasNtkWorker) {
        setOfflineStatus('Offline app cache is active.');
      } else if (settings.offlineModeEnabled) {
        setOfflineStatus('Offline app cache is turning on. It may finish after a refresh.');
      } else {
        setOfflineStatus('Offline app cache is off.');
      }
    };

    void refreshOfflineStatus();
    const timer = window.setTimeout(() => void refreshOfflineStatus(), 900);
    navigator.serviceWorker?.addEventListener?.('controllerchange', refreshOfflineStatus);
    return () => {
      window.clearTimeout(timer);
      navigator.serviceWorker?.removeEventListener?.('controllerchange', refreshOfflineStatus);
    };
  }, [settings.offlineModeEnabled]);

  const handleInstallPwa = async () => {
    if (!settings.offlineModeEnabled) {
      setInstallMessage('Turn on optional offline mode first so the browser can install the app.');
      return;
    }
    if (!installPrompt) {
      setInstallMessage('Your browser has not exposed an install prompt yet. Use the browser menu and choose Install app when available.');
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallMessage(choice.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed.');
    setInstallPrompt(null);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = importNotes(ev.target?.result as string);
      setImportResult(result ? 'Notes imported successfully!' : 'Failed to import. Invalid format.');
      setTimeout(() => setImportResult(null), 3000);
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    const data = exportAllNotes();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ntk-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sections = [
    { id: 'profile', icon: User, label: 'Profile' },
    { id: 'appearance', icon: Palette, label: 'Appearance' },
    { id: 'editor', icon: Type, label: 'Editor' },
    { id: 'shortcuts', icon: Keyboard, label: 'Shortcuts' },
    { id: 'sync', icon: ShieldCheck, label: 'Sync & Safety' },
    { id: 'data', icon: Download, label: 'Data & Backup' },
    { id: 'about', icon: Info, label: 'About' },
  ];

  const shortcuts = [
    { keys: 'Ctrl + B', desc: 'Bold text' },
    { keys: 'Ctrl + I', desc: 'Italic text' },
    { keys: 'Ctrl + U', desc: 'Underline text' },
    { keys: 'Ctrl + K', desc: 'Insert link' },
    { keys: 'Ctrl + S', desc: 'Save current note' },
    { keys: 'Ctrl + Shift + N', desc: 'New note' },
    { keys: 'Ctrl + /', desc: 'Command palette' },
    { keys: 'Ctrl + \\', desc: 'Toggle sidebar' },
    { keys: 'Ctrl + Alt + L', desc: 'Collapse notes list' },
    { keys: 'Ctrl + Alt + P', desc: 'Collapse editor panel' },
    { keys: 'Escape', desc: 'Close editor / Go back' },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <h2 className="text-2xl font-bold text-theme-primary mb-6">Settings</h2>

        {/* Section tabs */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
          {sections.map(sec => (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
              style={{
                backgroundColor: activeSection === sec.id ? 'var(--active-bg)' : 'transparent',
                color: activeSection === sec.id ? 'var(--badge-text)' : 'var(--text-tertiary)',
              }}
            >
              <sec.icon className="w-4 h-4 no-transition" />
              {sec.label}
            </button>
          ))}
        </div>

        {/* Profile Section */}
        {activeSection === 'profile' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Profile Information">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl accent-gradient flex items-center justify-center text-white text-xl font-bold shadow-lg">
                  {profile.initials}
                </div>
                <div>
                  <h3 className="font-semibold text-theme-primary">{profile.name}</h3>
                  <p className="text-sm text-theme-tertiary">{profile.email || 'No email set'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="settings-profile-name" className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
                  <input
                    id="settings-profile-name"
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile({ name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="settings-profile-email" className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
                  <input
                    id="settings-profile-email"
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    value={profile.email}
                    onChange={e => setProfile({ email: e.target.value })}
                    placeholder="your@email.com"
                    className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                  />
                </div>
              </div>
            </SettingCard>

            <SettingCard title="Statistics">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Total Notes', value: stats.notes },
                  { label: 'Total Words', value: stats.words.toLocaleString() },
                  { label: 'Tags', value: stats.tags },
                  { label: 'Notebooks', value: stats.notebooks },
                  { label: 'Tasks', value: stats.tasks },
                  { label: 'Completed', value: stats.completedTasks },
                ].map((s, i) => (
                  <div key={i} className="p-3 rounded-lg text-center" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <p className="text-xl font-bold text-theme-primary">{s.value}</p>
                    <p className="text-xs text-theme-tertiary">{s.label}</p>
                  </div>
                ))}
              </div>
            </SettingCard>
          </div>
        )}

        {/* Appearance Section */}
        {activeSection === 'appearance' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Theme">
              <div className="flex gap-3">
                <button
                  onClick={() => setTheme('light')}
                  className="flex-1 p-4 rounded-xl border-2 transition-all"
                  style={{
                    borderColor: settings.theme === 'light' ? 'var(--accent-primary)' : 'var(--card-border)',
                    backgroundColor: settings.theme === 'light' ? 'var(--active-bg)' : 'transparent',
                  }}
                >
                  <Sun className="w-6 h-6 text-amber-500 mx-auto mb-2 no-transition" />
                  <p className="text-sm font-medium text-center text-theme-secondary">Light</p>
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className="flex-1 p-4 rounded-xl border-2 transition-all"
                  style={{
                    borderColor: settings.theme === 'dark' ? 'var(--accent-primary)' : 'var(--card-border)',
                    backgroundColor: settings.theme === 'dark' ? 'var(--active-bg)' : 'transparent',
                  }}
                >
                  <Moon className="w-6 h-6 accent-text mx-auto mb-2 no-transition" />
                  <p className="text-sm font-medium text-center text-theme-secondary">Dark</p>
                </button>
              </div>
            </SettingCard>

            <SettingCard title="Accent Color">
              <div className="grid grid-cols-6 gap-3">
                {(Object.keys(accentColors) as ThemeAccent[]).map(color => (
                  <button
                    key={color}
                    onClick={() => setAccent(color)}
                    aria-label={`Set accent color to ${color}`}
                    className={`w-full aspect-square rounded-xl ${accentColors[color].bg} ${
                      settings.accent === color ? 'ring-2 ring-offset-2 scale-110' : ''
                    } hover:scale-105 transition-all`}
                    style={settings.accent === color ? {
                      '--tw-ring-offset-color': 'var(--card-bg)',
                      '--tw-ring-color': 'var(--accent-primary)',
                    } as React.CSSProperties : {}}
                    title={color}
                  />
                ))}
              </div>
            </SettingCard>

            <SettingCard title="Default Note Theme">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(Object.entries(noteThemes) as [NoteTheme, typeof noteThemes.canvas][]).map(([key, theme]) => (
                  <button
                    key={key}
                    onClick={() => updateSettings({ defaultNoteTheme: key })}
                    className="text-left rounded-xl border p-3 transition-all theme-hover"
                    style={{
                      borderColor: settings.defaultNoteTheme === key ? 'var(--accent-primary)' : 'var(--card-border)',
                      backgroundColor: settings.defaultNoteTheme === key ? 'var(--active-bg)' : 'transparent',
                    }}
                  >
                    <span className="block h-10 rounded-lg mb-2 border" style={{ background: theme.preview, borderColor: 'var(--card-border)' }} />
                    <span className="block text-sm font-semibold text-theme-primary">{theme.label}</span>
                    <span className="block text-xs text-theme-tertiary mt-0.5">{theme.description}</span>
                  </button>
                ))}
              </div>
            </SettingCard>

            <SettingCard title="Layout">
              <ToggleSetting
                label="Default view mode"
                description="Grid or list view for notes"
                value={settings.noteViewMode}
                options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]}
                onChange={(v) => updateSettings({ noteViewMode: v as 'grid' | 'list' })}
              />
              <ToggleSetting
                label="Density"
                description="Content density"
                value={settings.density}
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'spacious', label: 'Spacious' },
                ]}
                onChange={(v) => updateSettings({ density: v as 'compact' | 'comfortable' | 'spacious' })}
              />
              <div className="border-t theme-divider pt-4 space-y-4">
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Collapse sidebar</p>
                    <p className="text-xs text-theme-tertiary">Use an icon rail for the main menu on desktop</p>
                  </div>
                  <Switch
                    label="Collapse sidebar"
                    checked={settings.sidebarCollapsed}
                    onChange={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Collapse notes list</p>
                    <p className="text-xs text-theme-tertiary">Hide the list panel and keep a drawer handle</p>
                  </div>
                  <Switch
                    label="Collapse notes list"
                    checked={settings.noteListCollapsed}
                    onChange={() => updateSettings({
                      noteListCollapsed: !settings.noteListCollapsed,
                      editorPanelCollapsed: !settings.noteListCollapsed ? false : settings.editorPanelCollapsed,
                    })}
                  />
                </div>
                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Collapse editor panel</p>
                    <p className="text-xs text-theme-tertiary">Hide the preview/editor panel and keep a drawer handle</p>
                  </div>
                  <Switch
                    label="Collapse editor panel"
                    checked={settings.editorPanelCollapsed}
                    onChange={() => updateSettings({
                      editorPanelCollapsed: !settings.editorPanelCollapsed,
                      noteListCollapsed: !settings.editorPanelCollapsed ? false : settings.noteListCollapsed,
                    })}
                  />
                </div>
              </div>
            </SettingCard>
          </div>
        )}

        {/* Editor Section */}
        {activeSection === 'editor' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Editor Settings">
              <div className="space-y-4">
                <div>
                  <label htmlFor="settings-editor-font-size" className="block text-sm font-medium text-theme-secondary mb-2">
                    Font Size: {settings.editorFontSize}px
                  </label>
                  <input
                    id="settings-editor-font-size"
                    aria-label="Editor font size"
                    type="range"
                    min="12"
                    max="24"
                    value={settings.editorFontSize}
                    onChange={e => updateSettings({ editorFontSize: parseInt(e.target.value) })}
                    className="w-full accent-range"
                  />
                  <div className="flex justify-between text-xs text-theme-tertiary mt-1">
                    <span>12px</span>
                    <span>24px</span>
                  </div>
                </div>

                <div>
                  <label htmlFor="settings-editor-font-family" className="block text-sm font-medium text-theme-secondary mb-2">Font Family</label>
                  <select
                    id="settings-editor-font-family"
                    value={settings.editorFontFamily}
                    onChange={e => updateSettings({ editorFontFamily: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                  >
                    {['Modern Sans', 'Editorial Serif', 'Mono', 'System'].map(category => (
                      <optgroup key={category} label={category}>
                        {premiumFontFamilies.filter(font => font.category === category).map(font => (
                          <option key={font.value} value={font.value}>{font.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Show word count</p>
                    <p className="text-xs text-theme-tertiary">Display word and character count in status bar</p>
                  </div>
                  <Switch label="Show word count" checked={settings.showWordCount} onChange={() => updateSettings({ showWordCount: !settings.showWordCount })} />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Spell check</p>
                    <p className="text-xs text-theme-tertiary">Enable browser spell checking</p>
                  </div>
                  <Switch label="Spell check" checked={settings.spellCheck} onChange={() => updateSettings({ spellCheck: !settings.spellCheck })} />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-theme-secondary">Auto-save</p>
                    <p className="text-xs text-theme-tertiary">Automatically save notes as you type</p>
                  </div>
                  <Switch label="Auto-save" checked={settings.autoSave} onChange={() => updateSettings({ autoSave: !settings.autoSave })} />
                </div>

                <div>
                  <label htmlFor="settings-default-note-type" className="block text-sm font-medium text-theme-secondary mb-2">Default note type</label>
                  <select
                    id="settings-default-note-type"
                    value={settings.defaultNoteType}
                    onChange={e => updateSettings({ defaultNoteType: e.target.value as 'note' | 'checklist' | 'markdown' })}
                    className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                  >
                    <option value="note">Rich Text Note</option>
                    <option value="checklist">Checklist</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </div>
              </div>
            </SettingCard>
          </div>
        )}

        {/* Shortcuts Section */}
        {activeSection === 'shortcuts' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Keyboard Shortcuts">
              <div className="space-y-2">
                {shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <span className="text-sm text-theme-secondary">{s.desc}</span>
                    <kbd
                      className="px-2 py-1 rounded-md border text-xs font-mono"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--card-border)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </SettingCard>
          </div>
        )}

        {/* Sync Section */}
        {activeSection === 'sync' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Sync Status">
              <QuotaDashboard />
            </SettingCard>

            <SettingCard title="Offline & PWA">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg accent-soft flex items-center justify-center shrink-0">
                      <Wifi className="w-4 h-4 no-transition" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-theme-secondary">Optional offline mode</p>
                      <p className="text-xs text-theme-tertiary">
                        {online ? 'Local queue is ready for network interruptions.' : 'You are offline; changes will stay queued locally.'}
                      </p>
                    </div>
                  </div>
                  <Switch
                    label="Optional offline mode"
                    checked={settings.offlineModeEnabled}
                    onChange={() => {
                      setOfflineStatus(settings.offlineModeEnabled ? 'Turning offline app cache off...' : 'Turning offline app cache on...');
                      updateSettings({ offlineModeEnabled: !settings.offlineModeEnabled });
                    }}
                  />
                </div>
                <div className="rounded-lg px-3 py-2 text-xs text-theme-tertiary" style={{ backgroundColor: 'var(--input-bg)' }}>
                  {offlineStatus}
                </div>

                <button
                  onClick={handleInstallPwa}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors theme-hover"
                  style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text-secondary)' }}
                >
                  <DownloadCloud className="w-5 h-5 no-transition accent-text" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Install app</p>
                    <p className="text-xs text-theme-tertiary">
                      {installPrompt ? 'Browser install is available.' : 'Checks whether this browser can install NTK Note.'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>
                {installMessage && (
                  <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs text-theme-tertiary" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <RefreshCw className="w-3.5 h-3.5 no-transition mt-0.5 accent-text shrink-0" />
                    <span>{installMessage}</span>
                  </div>
                )}
              </div>
            </SettingCard>

            <SettingCard title="Sync Conflicts">
              {syncConflicts.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl p-4" style={{ backgroundColor: 'var(--input-bg)' }}>
                  <ShieldCheck className="w-5 h-5 text-emerald-500 no-transition" />
                  <div>
                    <p className="text-sm font-semibold text-theme-primary">No conflicts</p>
                    <p className="text-xs text-theme-tertiary">Local and cloud copies are aligned.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {syncConflicts.map(conflict => (
                    <div key={conflict.id} className="rounded-xl border theme-divider p-4" style={{ backgroundColor: 'var(--input-bg)' }}>
                      <div className="flex items-start gap-3 mb-3">
                        <AlertTriangle className="w-5 h-5 text-amber-500 no-transition shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-theme-primary truncate">{conflict.local.title || conflict.remote.title || 'Untitled note'}</p>
                          <p className="text-xs text-theme-tertiary">Detected {new Date(conflict.detectedAt).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          onClick={() => void resolveSyncConflict(conflict.id, 'local')}
                          className="px-3 py-2 rounded-lg accent-button text-sm font-medium"
                        >
                          Keep Local
                        </button>
                        <button
                          onClick={() => void resolveSyncConflict(conflict.id, 'remote')}
                          className="px-3 py-2 rounded-lg theme-hover text-sm font-medium text-theme-secondary"
                          style={{ backgroundColor: 'var(--card-bg)' }}
                        >
                          Keep Cloud
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SettingCard>
          </div>
        )}

        {/* Data Section */}
        {activeSection === 'data' && (
          <div className="space-y-6 animate-fade-in">
            {/* Import from other apps */}
            <SettingCard title="Import from Other Apps">
              <p className="text-sm text-theme-tertiary mb-4">
                Import your notes from Evernote, Google Keep, Notion, OneNote, Simplenote, and 10+ other apps.
              </p>
              <button
                onClick={() => setShowImportManager(true)}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-xl accent-gradient text-white transition-all shadow-lg"
              >
                <FolderInput className="w-5 h-5 no-transition" />
                <div className="text-left">
                  <p className="font-medium">Import from Other Apps</p>
                  <p className="text-xs opacity-75">Evernote, Google Keep, Notion, OneNote, and more...</p>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto no-transition" />
              </button>
            </SettingCard>

            <SettingCard title="Backup & Export">
              <div className="space-y-3">
                <button
                  onClick={handleExport}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(99, 102, 241, 0.08)', color: 'var(--badge-text)' }}
                >
                  <Download className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Export all notes</p>
                    <p className="text-xs opacity-75">Download as JSON backup file</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', color: '#10b981' }}
                >
                  <Upload className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Import NTK backup</p>
                    <p className="text-xs opacity-75">Import from JSON backup file</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />

                {importResult && (
                  <p className={`text-sm font-medium ${importResult.includes('success') ? 'text-emerald-500' : 'text-red-500'}`}>
                    {importResult}
                  </p>
                )}
              </div>
            </SettingCard>

            <SettingCard title="Danger Zone">
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#ef4444' }}
                >
                  <Trash2 className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Reset app</p>
                    <p className="text-xs opacity-75">Delete all data and start fresh</p>
                  </div>
                </button>
              ) : (
                <div className="p-4 rounded-xl border" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                  <p className="text-sm font-medium text-red-500 mb-3">
                    ⚠️ This will permanently delete all your notes, notebooks, and settings. This action cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { resetApp(); setShowResetConfirm(false); }}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                    >
                      Yes, delete everything
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="px-4 py-2 rounded-lg text-sm font-medium theme-hover"
                      style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text-secondary)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </SettingCard>
          </div>
        )}

        {/* About Section */}
        {activeSection === 'about' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="About NTK Note">
              <div className="text-center py-4">
                <BrandMark className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
                <h3 className="text-xl font-bold text-theme-primary">NTK Note</h3>
                <p className="text-theme-tertiary text-sm mt-1">Your Second Brain</p>
                <p className="text-xs text-theme-muted mt-2">Version 1.0.0</p>
                <p className="text-xs text-theme-tertiary mt-4 max-w-sm mx-auto">
                  A premium note-taking app combining the best features of Evernote, Simplenote, Google Keep, and OneNote.
                </p>
              </div>
            </SettingCard>
          </div>
        )}
      </div>

      {/* Import Manager Modal */}
      {showImportManager && (
        <ImportManager onClose={() => setShowImportManager(false)} />
      )}
    </div>
  );
}

function SettingCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl theme-card border p-5">
      <h3 className="font-semibold text-theme-primary mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      onClick={onChange}
      className="relative w-10 h-6 rounded-full transition-colors"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      style={{ backgroundColor: checked ? 'var(--accent-primary)' : 'var(--text-muted)' }}
    >
      <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function ToggleSetting({ label, description, value, options, onChange }: {
  label: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0 theme-divider">
      <div>
        <p className="text-sm font-medium text-theme-secondary">{label}</p>
        <p className="text-xs text-theme-tertiary">{description}</p>
      </div>
      <div className="flex gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--input-bg)' }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            style={{
              backgroundColor: value === opt.value ? 'var(--card-bg)' : 'transparent',
              color: value === opt.value ? 'var(--text-primary)' : 'var(--text-tertiary)',
              boxShadow: value === opt.value ? 'var(--card-shadow)' : 'none',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
