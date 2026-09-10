import { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Headphones,
  Loader2,
  Pause,
  Play,
  Sparkles,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  ListenOrchestrator,
  calculateCombinedAudioDuration,
  SpeechGenerationConfig,
  normalizeSpeechLanguage,
} from '@/utils/listenOrchestrator';
import { textToSpeech } from '@/utils/ntkAi';
import { useStore } from '@/store';

export interface ListenPlayerProps {
  text: string;
  isSelection: boolean;
  title: string;
  onClose: () => void;
  onSaveAudio?: (blob: Blob, durationSeconds: number) => Promise<void>;
}

export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export const LANGUAGE_OPTIONS = [
  { id: 'auto', label: 'Best Match (Auto)', badge: 'Recommended', classification: 'SUPPORTED', description: 'Automatically uses the best speech engine available.' },
  { id: 'en', label: 'English', badge: 'Neural Voice', classification: 'NATIVE', description: 'Standard English neural synthesis.' },
  { id: 'en-NG', label: 'English (Nigeria)', badge: 'Closest Match', classification: 'CLOSEST MATCH', description: 'Closest available English voice. Nigerian names, places and Naira formatting are preserved where possible.' },
  { id: 'ha-NG', label: 'Hausa (Nigeria)', badge: 'Google Fallback Native', classification: 'NATIVE', description: 'Native Hausa voice via Google Speech Fallback.' },
  { id: 'yo-NG', label: 'Yoruba (Nigeria)', badge: 'Regional Closest Match', classification: 'CLOSEST MATCH', description: 'Closest available English voice for regional notes.' },
  { id: 'ig-NG', label: 'Igbo (Nigeria)', badge: 'Regional Closest Match', classification: 'CLOSEST MATCH', description: 'Closest available English voice for regional notes.' },
] as const;

const buildSpeechConfig = (
  lang: string,
  allowClosest?: boolean
): SpeechGenerationConfig => ({
  language: normalizeSpeechLanguage(lang),
  allowClosestMatch: allowClosest ?? (lang === 'yo-NG' || lang === 'ig-NG'),
});

export default function ListenPlayer({
  text,
  isSelection,
  title,
  onClose,
  onSaveAudio,
}: ListenPlayerProps) {
  const { settings, updateSettings } = useStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number>(settings.listenSpeed || 1);
  const [language, setLanguage] = useState<string>(() => normalizeSpeechLanguage(settings.listenLanguage || 'auto'));
  const [showVoiceDiscovery, setShowVoiceDiscovery] = useState(false);
  const [showFollowAlong, setShowFollowAlong] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [previewing, setPreviewing] = useState(false);
  const [preparingAllAudio, setPreparingAllAudio] = useState(false);
  const [prepareProgress, setPrepareProgress] = useState<{ current: number; total: number } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const chunksRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const orchestratorRef = useRef<ListenOrchestrator | null>(null);

  const cleanupPreview = () => {
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
    setPreviewing(false);
  };

  const stopCurrentAudioElement = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      try {
        URL.revokeObjectURL(currentAudioUrlRef.current);
      } catch {
        /* ignore */
      }
      currentAudioUrlRef.current = null;
    }
  };

  const cancelPreparingAllAudio = () => {
    orchestratorRef.current?.cancelPreparation();
    setPreparingAllAudio(false);
    setPrepareProgress(null);
  };

  /**
   * Stops audio playback and cancels any active single-chunk playback fetch.
   * Crucial: When cancelFullPreparation is false (e.g. automatic playback transition on audio.onended),
   * active complete-audio preparation (Save or Download) is preserved without interruption.
   */
  const stopPlayback = (options?: { cancelFullPreparation?: boolean }) => {
    if (options?.cancelFullPreparation) {
      cancelPreparingAllAudio();
    }
    orchestratorRef.current?.stopPlayback(options);
    isPlayingRef.current = false;
    setIsPlaying(false);
    setLoading(false);
    stopCurrentAudioElement();
  };

  const playChunk = async (index: number) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) return;
    if (index < 0 || index >= chunksRef.current.length) return;

    // Stop previous single-chunk audio/fetch, but PRESERVE active full preparation
    stopPlayback({ cancelFullPreparation: false });
    setError(null);
    setLoading(true);

    try {
      const blob = await orchestrator.startPlayback(index);
      if (!blob) {
        setLoading(false);
        return;
      }

      setLoading(false);
      stopCurrentAudioElement();

      const url = URL.createObjectURL(blob);
      currentAudioUrlRef.current = url;
      const audio = new Audio(url);
      audio.playbackRate = speed;
      audioRef.current = audio;
      isPlayingRef.current = true;
      setIsPlaying(true);
      setCurrentChunkIndex(index);

      audio.onended = () => {
        const nextIndex = index + 1;
        if (nextIndex < chunksRef.current.length && isPlayingRef.current) {
          void playChunk(nextIndex);
        } else {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      };

      audio.onerror = () => {
        setIsPlaying(false);
        isPlayingRef.current = false;
        setError('Playback failed. Please try again.');
      };

      await audio.play();

      // Section 10: Canonical prefetch using orchestrator
      const nextIndex = index + 1;
      if (nextIndex < chunksRef.current.length) {
        void orchestrator.prefetchChunk(nextIndex);
      }
    } catch (err: unknown) {
      setLoading(false);
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not generate speech.');
    }
  };

  // Split long text into natural paragraph/sentence chunks if > 1200 characters
  useEffect(() => {
    const cleanText = text.trim();
    if (!cleanText) {
      setError('No text to speak.');
      return;
    }

    const chunks = splitTextIntoChunks(cleanText, 1200);
    chunksRef.current = chunks;
    setTotalChunks(chunks.length);
    setCurrentChunkIndex(0);

    const initialConfig = buildSpeechConfig(language);
    const orchestrator = new ListenOrchestrator({
      chunks,
      config: initialConfig,
      onPlaybackChunkChange: (idx) => setCurrentChunkIndex(idx),
      onProgress: (p) => setPrepareProgress(p),
      onError: (err) => setError(err.message),
    });
    orchestratorRef.current = orchestrator;

    // Auto-start playback on mount
    void playChunk(0);

    return () => {
      cancelPreparingAllAudio();
      stopPlayback({ cancelFullPreparation: true });
      cleanupPreview();
    };
  }, [text]);

  const handlePlayPause = () => {
    if (loading) return;
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      if (audioRef.current && audioRef.current.src) {
        audioRef.current.playbackRate = speed;
        audioRef.current
          .play()
          .then(() => {
            setIsPlaying(true);
            isPlayingRef.current = true;
          })
          .catch(() => {
            void playChunk(currentChunkIndex);
          });
      } else {
        void playChunk(currentChunkIndex);
      }
    }
  };

  const handleStop = () => {
    stopPlayback({ cancelFullPreparation: true });
    setCurrentChunkIndex(0);
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    updateSettings({ listenSpeed: newSpeed });
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
    // Section 6, 10: Speed is client-side playbackRate only.
    // It does not alter generated speech or invalidate orchestrator blobs.
  };

  const handleLanguageChange = (newLang: string) => {
    const normalized = normalizeSpeechLanguage(newLang);
    setLanguage(normalized);
    updateSettings({ listenLanguage: normalized });
    if (orchestratorRef.current) {
      const newConfig = buildSpeechConfig(normalized);
      const invalidated = orchestratorRef.current.updateConfig(newConfig);
      if (invalidated) {
        void playChunk(currentChunkIndex);
      }
    }
  };

  /**
   * Independent Action 1: DOWNLOAD
   * Downloads generated complete audio bytes to the user's device.
   * Ensures all note chunks are synthesized before downloading.
   * Does NOT require saving to note or uploading to R2.
   */
  const handleDownloadAudio = async () => {
    if (preparingAllAudio || saving || !orchestratorRef.current) return;
    setError(null);
    setPreparingAllAudio(true);
    try {
      const result = await orchestratorRef.current.downloadCompleteAudio((combinedBlob) => {
        const url = URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        const safeTitle = (title || 'Listen').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `${safeTitle || 'Note'}-Audio-${dateStr}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setDownloaded(true);
        setTimeout(() => {
          URL.revokeObjectURL(url);
          setDownloaded(false);
        }, 4000);
      });
      if (!result.success && result.error && result.error !== 'Audio preparation was not complete') {
        setError(result.error);
      }
    } catch {
      setError('Could not download audio.');
    } finally {
      setPreparingAllAudio(false);
      setPrepareProgress(null);
    }
  };

  /**
   * Independent Action 2: SAVE TO NOTE
   * Persists complete audio into the note's media storage (R2 primary, IndexedDB offline fallback).
   * Ensures all note chunks are synthesized before saving.
   */
  const handleSaveAudio = async () => {
    if (!onSaveAudio || saving || saved || preparingAllAudio || !orchestratorRef.current) return;
    setError(null);
    setSaving(true);
    setPreparingAllAudio(true);
    try {
      const result = await orchestratorRef.current.saveCompleteAudio(async (combinedBlob) => {
        // Section 13: Accurate total duration metadata for multi-chunk note
        const totalDuration = calculateCombinedAudioDuration({
          textLength: text.length,
          chunkCount: chunksRef.current.length,
          speed,
          currentChunkDuration: audioRef.current?.duration,
          currentChunkLength: chunksRef.current[currentChunkIndex]?.length,
        });

        await onSaveAudio(combinedBlob, totalDuration);
        setSaved(true);
      });
      if (!result.success && result.error && result.error !== 'Audio preparation was not complete') {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save audio.');
    } finally {
      setSaving(false);
      setPreparingAllAudio(false);
      setPrepareProgress(null);
    }
  };

  /**
   * Truthful Single Voice Preview (Sections 7-9 AbortController & stale guard)
   */
  const previewCurrentVoice = async () => {
    if (previewing) {
      cleanupPreview();
      return;
    }
    cleanupPreview();
    const controller = new AbortController();
    previewAbortControllerRef.current = controller;
    setPreviewing(true);
    try {
      const normalizedLang = normalizeSpeechLanguage(language);
      const sampleText = normalizedLang === 'ha-NG'
        ? 'Barka da zuwa NTK Note. Wannan samfurin murya ne.'
        : 'Welcome to NTK Note. This is a voice preview for your note.';
      const blob = await textToSpeech(
        {
          text: sampleText,
          language: normalizedLang,
          allowClosestMatch: normalizedLang === 'yo-NG' || normalizedLang === 'ig-NG',
          format: 'mp3',
        },
        controller.signal
      );

      // Stale async result guard (Section 9):
      // If user cancelled, clicked preview again, or component unmounted, abandon.
      if (controller.signal.aborted || previewAbortControllerRef.current !== controller) {
        return;
      }

      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.playbackRate = speed;
      audio.onended = () => cleanupPreview();
      audio.onerror = () => cleanupPreview();
      await audio.play();
    } catch (err: unknown) {
      if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') {
        return;
      }
      cleanupPreview();
    }
  };


  const activeChunkText = chunksRef.current[currentChunkIndex] || text.slice(0, 300);

  return (
    <div
      role="region"
      aria-label="Listen audio player"
      className="rounded-2xl border theme-border theme-card p-3.5 shadow-lg transition-all animate-in fade-in duration-200"
    >
      {/* Top Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b theme-divider">
        {/* Left info & status */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl accent-soft accent-text">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Volume2 className="h-4 w-4 animate-pulse" />
            ) : (
              <Headphones className="h-4 w-4 text-theme-tertiary" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-theme-primary truncate max-w-[220px]">
                {isSelection ? 'Listen to selection' : (title || 'Listen to note')}
              </span>
              {totalChunks > 1 && (
                <span className="text-[10px] font-semibold text-theme-tertiary">
                  (part {currentChunkIndex + 1}/{totalChunks})
                </span>
              )}
            </div>
            <div className="text-[11px] text-theme-tertiary">
              {error ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-rose-500 font-medium">{error}</span>
                  {error.includes('closest available voice') && (
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage('en-NG');
                        updateSettings({ listenLanguage: 'en-NG' });
                        if (orchestratorRef.current) {
                          const newConfig = buildSpeechConfig('en-NG', true);
                          orchestratorRef.current.updateConfig(newConfig);
                          void playChunk(currentChunkIndex);
                        }
                      }}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-500/30 transition-colors"
                    >
                      Use closest voice
                    </button>
                  )}
                </div>
              ) : loading ? (
                'Generating audio…'
              ) : isPlaying ? (
                'Playing note…'
              ) : (
                'Paused'
              )}
            </div>
          </div>
        </div>

        {/* Center audio playback controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={loading}
            onClick={handlePlayPause}
            className="flex h-9 w-9 items-center justify-center rounded-xl accent-button shadow-sm disabled:opacity-50"
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleStop}
            disabled={loading || (!isPlaying && currentChunkIndex === 0)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border theme-border theme-hover text-theme-secondary disabled:opacity-40"
            title="Stop playback"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </button>

          {/* Speed selector */}
          <select
            value={speed}
            onChange={e => handleSpeedChange(Number(e.target.value))}
            disabled={preparingAllAudio || saving}
            aria-label="Playback speed"
            className="rounded-lg border theme-input px-2 py-1 text-xs font-semibold text-theme-secondary disabled:opacity-50"
          >
            {SPEED_OPTIONS.map(s => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>

          {/* Voice Discovery / Options Button */}
          <button
            type="button"
            onClick={() => setShowVoiceDiscovery(!showVoiceDiscovery)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors ${
              showVoiceDiscovery
                ? 'accent-soft accent-text border-indigo-400/40'
                : 'theme-border theme-hover text-theme-secondary'
            }`}
            title="Voice & Language Options"
            aria-label="Voice & Language Options"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Voice</span>
            {showVoiceDiscovery ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Right action group: DOWNLOAD and SAVE TO NOTE (Separated per Addendum B) */}
        <div className="flex items-center gap-1.5 ml-auto sm:ml-0">
          {/* Download button: downloads MP3 file to device directly */}
          <button
            type="button"
            onClick={() => void handleDownloadAudio()}
            disabled={loading || saving || preparingAllAudio}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
              downloaded
                ? 'border-blue-500/20 bg-blue-500/10 text-blue-600'
                : 'theme-border theme-hover text-theme-secondary disabled:opacity-40'
            }`}
            title="Download audio file to your device (no save required)"
            aria-label="Download audio file"
          >
            {downloaded ? (
              <>
                <Check className="h-3.5 w-3.5 text-blue-600" />
                <span>Downloaded</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </>
            )}
          </button>

          {/* Save to note button: persists audio as a voice note in the note */}
          {onSaveAudio && (
            <button
              type="button"
              onClick={() => void handleSaveAudio()}
              disabled={saving || saved || loading || preparingAllAudio}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors ${
                saved
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                  : 'theme-border theme-hover text-theme-secondary disabled:opacity-40'
              }`}
              title="Save audio permanently to this note"
              aria-label="Save audio to note"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  <span>Save to note</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              cancelPreparingAllAudio();
              stopPlayback({ cancelFullPreparation: true });
              cleanupPreview();
              onClose();
            }}
            className="rounded-lg p-1.5 text-theme-tertiary theme-hover"
            aria-label="Close Listen player"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Long-note preparation progress banner (Sections 16 & 17) */}
      {preparingAllAudio && prepareProgress && (
        <div className="flex items-center justify-between p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs mt-2.5 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-[11px]">
              Preparing complete audio… {prepareProgress.current} of {prepareProgress.total}
            </span>
          </div>
          <button
            type="button"
            onClick={cancelPreparingAllAudio}
            className="px-2 py-0.5 rounded-md border border-indigo-500/30 hover:bg-indigo-500/20 text-[10px] font-bold transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Voice & Language Settings Drawer (Sections 4, 5, 6, 7, 8, 9) */}
      {showVoiceDiscovery && (
        <div className="mt-3 pt-3 border-t theme-divider space-y-3 animate-in fade-in duration-150">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Language & Regional Accent */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-theme-tertiary mb-1">
                Language & Accent
              </label>
              <select
                value={language}
                onChange={e => handleLanguageChange(e.target.value)}
                disabled={preparingAllAudio || saving}
                className="w-full rounded-lg border theme-input px-2.5 py-1.5 text-xs text-theme-primary font-medium disabled:opacity-50"
              >
                {LANGUAGE_OPTIONS.map(opt => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label} ({opt.badge})
                  </option>
                ))}
              </select>
            </div>

            {/* Playback Speed */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-theme-tertiary mb-1">
                Voice Playback Rate
              </label>
              <select
                value={speed}
                onChange={e => handleSpeedChange(Number(e.target.value))}
                disabled={preparingAllAudio || saving}
                className="w-full rounded-lg border theme-input px-2.5 py-1.5 text-xs text-theme-primary font-medium disabled:opacity-50"
              >
                {SPEED_OPTIONS.map(s => (
                  <option key={s} value={s}>
                    {s}x Speed
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Nigerian English Localization Badge (Section 8) */}
          {language === 'en-NG' && (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs">
              <span className="text-base">🇳🇬</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[11px]">Nigerian English (Closest Match)</p>
                <p className="text-[10px] opacity-90">
                  Nigerian English — closest available English voice. Nigerian names, places and Naira formatting are preserved where possible.
                </p>
              </div>
            </div>
          )}

          {/* Hausa Localization Badge (Section 17) */}
          {language === 'ha-NG' && (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs">
              <span className="text-base">🇳🇬</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[11px]">Hausa (Google Fallback Native)</p>
                <p className="text-[10px] opacity-90">
                  Routed natively via Google Speech Fallback for natural Hausa pronunciation.
                </p>
              </div>
            </div>
          )}

          {/* Yoruba & Igbo Regional Notice (Section 9) */}
          {(language === 'yo-NG' || language === 'ig-NG') && (
            <div className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs">
              <span className="text-base">ℹ️</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[11px]">{language === 'yo-NG' ? 'Yoruba' : 'Igbo'} Regional Language Note</p>
                <p className="text-[10px] opacity-90">
                  Native neural voices for {language === 'yo-NG' ? 'Yoruba' : 'Igbo'} are unavailable on standard zero-cost engines. The system uses the closest available English voice with preserved formatting.
                </p>
              </div>
            </div>
          )}

          {/* Truthful Voice Preview & Capabilities Note (Section 4, 5, 6, 7) */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border theme-border bg-theme-secondary/20">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-theme-primary">Voice Customization Notice</p>
              <p className="text-[10px] text-theme-tertiary">
                Voice styles and gender selection are not available with the current no-cost speech engines. Synthesis uses the official neural engine for your selected language.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void previewCurrentVoice()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-primary shrink-0"
              title={previewing ? "Stop preview voice" : "Preview voice for current language"}
              aria-label={previewing ? "Stop preview voice" : "Preview voice"}
            >
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{previewing ? 'Playing…' : 'Preview voice'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Follow Along / Progress Card (Addendum F) */}
      {totalChunks > 0 && (
        <div className="mt-2.5 pt-2 border-t theme-divider">
          <div className="flex items-center justify-between text-[11px] text-theme-tertiary mb-1">
            <button
              type="button"
              onClick={() => setShowFollowAlong(!showFollowAlong)}
              className="inline-flex items-center gap-1 font-semibold text-theme-secondary hover:underline"
            >
              <span>Follow Along</span>
              {showFollowAlong ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <span>
              Progress: {currentChunkIndex + 1} / {totalChunks}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-[var(--card-border)] h-1 rounded-full overflow-hidden mb-2">
            <div
              className="accent-button h-full transition-all duration-300"
              style={{ width: `${Math.round(((currentChunkIndex + 1) / totalChunks) * 100)}%` }}
            />
          </div>

          {showFollowAlong && (
            <div className="rounded-xl bg-[var(--app-bg-subtle)] p-2.5 text-xs text-theme-primary border theme-border font-serif leading-relaxed italic line-clamp-3">
              “{activeChunkText}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'rev', 'gen', 'gov', 'sen', 'hon',
  'eg', 'ie', 'vs', 'etc', 'st', 'ave', 'rd', 'no', 'al', 'ltd', 'inc', 'corp', 'co',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
]);

/**
 * Split a paragraph into clean sentences while preserving abbreviations (e.g. Dr., Prof.),
 * initials, currency figures (e.g. ₦25,000 or $10.50), and decimal numbers.
 */
export function splitIntoSentences(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  const words = text.split(/(\s+)/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current += word;

    const match = word.match(/([.!?]+)(['"”’)]*)$/);
    if (match) {
      const punct = match[1];
      const pureWord = word.slice(0, -match[0].length).replace(/^['"“(]+/, '');
      const lower = pureWord.toLowerCase().replace(/\./g, '');

      const isAbbr = ABBREVIATIONS.has(lower);
      const isInitial = /^[A-Za-z]$/.test(pureWord);
      const isQuestionOrExclamation = punct.includes('?') || punct.includes('!');

      if (isQuestionOrExclamation || (!isAbbr && !isInitial)) {
        const nextWord = words.slice(i + 1).find(w => w.trim().length > 0);
        if (!nextWord || /^[A-Z0-9"“'‘₦$]/.test(nextWord.trim())) {
          tokens.push(current.trim());
          current = '';
        }
      }
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens.length > 0 ? tokens : [text.trim()];
}

/**
 * Split text at sentence and paragraph boundaries without breaking words or numbers.
 */
export function splitTextIntoChunks(text: string, maxChunkLength = 1200): string[] {
  if (text.length <= maxChunkLength) return [text];

  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if ((currentChunk + '\n\n' + trimmedPara).length <= maxChunkLength) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + trimmedPara : trimmedPara;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      if (trimmedPara.length <= maxChunkLength) {
        currentChunk = trimmedPara;
      } else {
        const sentences = splitIntoSentences(trimmedPara);
        for (const sentence of sentences) {
          const trimmedSentence = sentence.trim();
          if (!trimmedSentence) continue;

          if ((currentChunk + ' ' + trimmedSentence).length <= maxChunkLength) {
            currentChunk = currentChunk ? currentChunk + ' ' + trimmedSentence : trimmedSentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
              currentChunk = '';
            }
            if (trimmedSentence.length <= maxChunkLength) {
              currentChunk = trimmedSentence;
            } else {
              // Fallback word wrap if an individual sentence exceeds max length
              const words = trimmedSentence.split(/\s+/);
              for (const word of words) {
                if ((currentChunk + ' ' + word).length <= maxChunkLength) {
                  currentChunk = currentChunk ? currentChunk + ' ' + word : word;
                } else {
                  if (currentChunk) chunks.push(currentChunk);
                  currentChunk = word;
                }
              }
            }
          }
        }
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length ? chunks : [text];
}
