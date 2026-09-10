import { useState, useRef, useEffect } from 'react';
import {
  Check,
  Cloud,
  Database,
  Download,
  Globe2,
  Laptop,
  Loader2,
  Moon,
  Palette,
  Play,
  RefreshCw,
  Sun,
  User,
  Volume2,
  Wifi,
  ShieldCheck,
} from 'lucide-react';
import { useStore } from '@/store';
import UserAvatar from './UserAvatar';
import {
  LANGUAGE_OPTIONS,
  SPEED_OPTIONS,
} from './ListenPlayer';
import { normalizeSpeechLanguage } from '@/utils/listenOrchestrator';
import { textToSpeech } from '@/utils/ntkAi';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/utils/firebase';

export default function MyProfileView() {
  const {
    profile,
    setProfile,
    settings,
    updateSettings,
    setTheme,
    online,
    syncStatus,
    manualSync,
    exportAllNotes,
    notes,
    notebooks,
  } = useStore();

  const syncing = syncStatus === 'syncing';
  const syncNow = manualSync;

  const [activeTab, setActiveTab] = useState<
    'profile' | 'listening' | 'preferences' | 'sync' | 'storage' | 'accessibility'
  >('profile');

  const [editName, setEditName] = useState(profile.name);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const cleanupVoicePreview = () => {
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    if (previewUrlRef.current) {
      try {
        URL.revokeObjectURL(previewUrlRef.current);
      } catch {
        /* ignore */
      }
      previewUrlRef.current = null;
    }
    setPreviewingVoice(false);
  };

  useEffect(() => {
    return () => {
      cleanupVoicePreview();
    };
  }, []);

  const handleSaveName = () => {
    if (!editName.trim()) return;
    setSavingName(true);
    setProfile({ ...profile, name: editName.trim() });
    setTimeout(() => {
      setSavingName(false);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    }, 300);
  };

  const handlePreviewVoice = async () => {
    if (previewingVoice) {
      cleanupVoicePreview();
      return;
    }
    cleanupVoicePreview();
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    setPreviewingVoice(true);
    try {
      const normalizedLang = normalizeSpeechLanguage(settings.listenLanguage || 'auto');
      const sampleText = normalizedLang === 'ha-NG'
        ? 'Barka da zuwa NTK Note. Wannan samfurin murya ne.'
        : 'Hello, this is a sample preview of this voice for your notes.';
      const blob = await textToSpeech(
        {
          text: sampleText,
          language: normalizedLang,
          allowClosestMatch: true,
          format: 'mp3',
        },
        controller.signal
      );

      // Stale async result guard (Section 9):
      if (controller.signal.aborted || previewAbortControllerRef.current !== controller) {
        return;
      }

      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.playbackRate = settings.listenSpeed || 1;
      audio.onended = () => {
        cleanupVoicePreview();
      };
      audio.onerror = () => {
        cleanupVoicePreview();
      };
      await audio.play();
    } catch (err: unknown) {
      if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') {
        return;
      }
      cleanupVoicePreview();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto theme-bg p-4 pb-24 sm:p-6 sm:pb-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header card with Avatar & Quick stats */}
        <div className="rounded-3xl border theme-border theme-card p-6 shadow-sm flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <UserAvatar profile={profile} size="lg" className="h-20 w-20 text-2xl shadow-md" />
          <div className="flex-1 text-center sm:text-left min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1">
              <h1 className="text-2xl font-bold text-theme-primary">{profile.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold accent-soft accent-text">
                {profile.email ? 'Personal Account' : 'Guest Mode'}
              </span>
            </div>
            <p className="text-xs text-theme-tertiary truncate">{profile.email || 'Local offline storage'}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-theme-secondary">
              <div>
                <span className="font-bold text-theme-primary">{notes.filter(n => !n.trashed).length}</span> notes
              </div>
              <span className="text-theme-tertiary">•</span>
              <div>
                <span className="font-bold text-theme-primary">{notebooks.filter(nb => !nb.trashed).length}</span> notebooks
              </div>
              <span className="text-theme-tertiary">•</span>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span>{online ? 'Connected' : 'Offline'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 border-b theme-divider" role="tablist">
          {[
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'listening', label: 'Listening & Voice', icon: Volume2 },
            { id: 'preferences', label: 'Preferences', icon: Palette },
            { id: 'sync', label: 'Sync & Devices', icon: RefreshCw },
            { id: 'storage', label: 'Storage & Backup', icon: Database },
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                  active
                    ? 'accent-soft accent-text shadow-sm'
                    : 'text-theme-secondary theme-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Profile Details */}
        {activeTab === 'profile' && (
          <div className="space-y-4 rounded-3xl border theme-border theme-card p-6">
            <h2 className="text-base font-bold text-theme-primary">Profile Details</h2>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1">Display Name</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="flex-1 rounded-xl border theme-input px-3 py-2 text-sm text-theme-primary outline-none accent-focus"
                    placeholder="Your name"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={savingName || editName === profile.name}
                    aria-label="Save display name"
                    className="px-4 py-2 rounded-xl accent-button text-xs font-bold disabled:opacity-40"
                  >
                    {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : nameSaved ? <Check className="w-4 h-4" /> : 'Save'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1">Email Address</label>
                <input
                  type="email"
                  value={profile.email || ''}
                  disabled
                  className="w-full rounded-xl border theme-input px-3 py-2 text-sm text-theme-tertiary bg-[var(--app-bg-subtle)] cursor-not-allowed"
                />
                {profile.email ? (
                  <p className="mt-1 text-[11px] text-theme-tertiary">
                    Authentication is managed through Google Firebase ({profile.email}).
                  </p>
                ) : (
                  <div className="mt-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      You are using NTK Note as a Guest. Sign in with Google to sync notes across devices and unlock administrator controls.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await signInWithPopup(auth, googleProvider);
                        } catch (err) {
                          console.error('Sign in with Google failed:', err);
                        }
                      }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold text-theme-primary bg-amber-500/20 hover:bg-amber-500/30 transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                      <span>Sign in with Google</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Messaging & Privacy Controls */}
              <div className="pt-4 border-t theme-divider space-y-3">
                <h3 className="text-xs font-bold text-theme-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-theme-tertiary" />
                  Messaging & Privacy
                </h3>
                
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.discoverable !== false}
                      onChange={e => setProfile({ ...profile, discoverable: e.target.checked })}
                      className="mt-0.5 rounded text-[var(--accent-primary)] focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-theme-primary">
                        Allow other NTK Note users to find me
                      </p>
                      <p className="text-[11px] text-theme-tertiary">
                        When enabled, collaborators can find your profile in Share and Messages by searching your name.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={profile.allowMessageRequests !== false}
                      onChange={e => setProfile({ ...profile, allowMessageRequests: e.target.checked })}
                      className="mt-0.5 rounded text-[var(--accent-primary)] focus:ring-0"
                    />
                    <div>
                      <p className="text-xs font-semibold text-theme-primary">
                        Allow message requests from new contacts
                      </p>
                      <p className="text-[11px] text-theme-tertiary">
                        Allows registered users to send you an initial message request before chatting.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Tab 2: Listening & Voice */}
        {activeTab === 'listening' && (
          <div className="space-y-6 rounded-3xl border theme-border theme-card p-6">
            <div>
              <h2 className="text-base font-bold text-theme-primary flex items-center gap-2">
                <Volume2 className="w-5 h-5 accent-text" />
                Listening & Voice Settings
              </h2>
              <p className="text-xs text-theme-tertiary mt-0.5">
                Set your default language and playback speed for reading notes.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Default Language & Accent */}
              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1.5 flex items-center gap-1.5">
                  <Globe2 className="w-3.5 h-3.5 text-theme-tertiary" />
                  Default Language
                </label>
                <select
                  value={normalizeSpeechLanguage(settings.listenLanguage || 'auto')}
                  onChange={e => updateSettings({ listenLanguage: normalizeSpeechLanguage(e.target.value) })}
                  className="w-full rounded-xl border theme-input px-3 py-2 text-sm text-theme-primary"
                >
                  {LANGUAGE_OPTIONS.map(opt => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} {opt.badge ? `(${opt.badge})` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-theme-tertiary">
                  Language setting automatically selects the corresponding speech engine.
                </p>
              </div>

              {/* Default Playback Speed */}
              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1.5">
                  Default Playback Speed
                </label>
                <div className="flex gap-2">
                  {SPEED_OPTIONS.map(s => {
                    const active = (settings.listenSpeed || 1) === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => updateSettings({ listenSpeed: s })}
                        className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                          active
                            ? 'accent-button shadow-sm'
                            : 'theme-border theme-hover text-theme-secondary'
                        }`}
                      >
                        {s}x
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Truthful Engine Capability Notice */}
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-bold">Speech Customization Notice</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-400 leading-relaxed">
                Voice customization is not available with the current no-cost speech engines. Synthesis uses official Cloudflare Workers AI edge models with zero-cost Google Speech Fallback.
              </p>
            </div>

            {/* Truthful Regional Language Guidance */}
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xl">🇳🇬</span>
                <p className="font-bold text-xs text-emerald-800 dark:text-emerald-300">
                  Nigerian & Regional Languages
                </p>
              </div>
              <ul className="text-xs text-emerald-700 dark:text-emerald-400 space-y-1.5 leading-relaxed list-disc list-inside">
                <li>
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">Nigerian English:</span> Nigerian English uses the closest available English voice. NTK Note preserves Nigerian names, places and Naira formatting where possible.
                </li>
                <li>
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">Hausa:</span> Uses the available Hausa fallback voice.
                </li>
                <li>
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">Yoruba / Igbo:</span> Native synthesis is not currently available on the no-cost speech engines. You can choose the closest available English voice.
                </li>
              </ul>
            </div>

            {/* Preview Voice Action */}
            <div className="flex items-center justify-between pt-2 border-t theme-border">
              <div>
                <p className="text-xs font-bold text-theme-primary">Voice Sample</p>
                <p className="text-[11px] text-theme-tertiary">Preview audio with your current language and playback speed.</p>
              </div>
              <button
                type="button"
                onClick={() => void handlePreviewVoice()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold accent-button shadow-sm"
              >
                {previewingVoice ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Playing sample…
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Preview voice
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Preferences */}
        {activeTab === 'preferences' && (
          <div className="space-y-4 rounded-3xl border theme-border theme-card p-6">
            <h2 className="text-base font-bold text-theme-primary">Appearance & Behavior</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1">Theme</label>
                <div className="flex gap-2">
                  {[
                    { id: 'light', label: 'Light', icon: Sun },
                    { id: 'dark', label: 'Dark', icon: Moon },
                    { id: 'system', label: 'System', icon: Laptop },
                  ].map(t => {
                    const Icon = t.icon;
                    const active = (settings.theme || 'system') === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id as any)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                          active ? 'accent-button shadow-sm' : 'theme-border theme-hover text-theme-secondary'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-theme-secondary mb-1">Layout Density</label>
                <div className="flex gap-2">
                  {['compact', 'comfortable', 'spacious'].map(d => {
                    const active = (settings.density || 'comfortable') === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateSettings({ density: d as any })}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold capitalize border transition-all ${
                          active ? 'accent-button shadow-sm' : 'theme-border theme-hover text-theme-secondary'
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Sync & Devices */}
        {activeTab === 'sync' && (
          <div className="space-y-4 rounded-3xl border theme-border theme-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-theme-primary">Cloud Synchronization</h2>
                <p className="text-xs text-theme-tertiary">Real-time sync to Cloud Firestore and Cloudflare R2.</p>
              </div>
              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={syncing || !online}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl accent-button text-xs font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing…' : 'Sync Now'}</span>
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--app-bg-subtle)] border theme-border flex items-center gap-3 text-xs">
              <Wifi className={`w-5 h-5 ${online ? 'text-emerald-500' : 'text-amber-500'}`} />
              <div>
                <p className="font-bold text-theme-primary">
                  {online ? 'Online & Synchronized' : 'Working Offline'}
                </p>
                <p className="text-theme-tertiary">
                  {online
                    ? 'All notes and media changes are uploaded immediately to primary Cloudflare R2.'
                    : 'Notes and recordings are stored safely in local IndexedDB and will synchronize once reconnected.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Storage & Backup */}
        {activeTab === 'storage' && (
          <div className="space-y-4 rounded-3xl border theme-border theme-card p-6">
            <h2 className="text-base font-bold text-theme-primary">Storage & Backup Architecture</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border theme-border bg-[var(--app-bg-subtle)]">
                <div className="flex items-center gap-2 mb-2">
                  <Cloud className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-xs font-bold text-theme-primary">Primary Live Storage</h3>
                </div>
                <p className="text-xs text-theme-secondary font-medium">Cloudflare R2 (NTK_FILES)</p>
                <p className="text-[11px] text-theme-tertiary mt-1">
                  Canonical primary storage for photos, recorded memos, and saved voice notes.
                </p>
              </div>

              <div className="p-4 rounded-2xl border theme-border bg-[var(--app-bg-subtle)]">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-blue-500" />
                  <h3 className="text-xs font-bold text-theme-primary">Independent Backup Store</h3>
                </div>
                <p className="text-xs text-theme-secondary font-medium">Backblaze B2 (ntk-note-backups)</p>
                <p className="text-[11px] text-theme-tertiary mt-1">
                  Independent recovery destination only. Preserved strictly for emergency backups.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => void exportAllNotes()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border theme-border theme-hover text-xs font-bold text-theme-primary"
              >
                <Download className="w-4 h-4" />
                <span>Export All Notes (JSON)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
