/**
 * NTK Note — Production Listen & Long-Audio Orchestrator
 *
 * Provides lifecycle coordination for chunked text-to-speech playback,
 * long-audio completion, and resilient Save / Download workflows.
 *
 * Core Guarantees:
 * 1. Automatic playback chunk transitions (e.g. chunk 1 -> chunk 2 on audio.onended)
 *    MUST NOT abort an active complete-audio preparation (Save or Download).
 * 2. Only explicit user actions (Stop, Close, Cancel button) cancel full preparation.
 * 3. Incomplete chunks NEVER produce a saved or downloaded audio file.
 * 4. Exactly one Save = exactly one combined audio blob and one R2 upload.
 * 5. Download and Save are strictly independent actions.
 * 6. Playback config == Prefetch config == Save config == Download config (Section 7).
 * 7. When synthesis configuration changes, incompatible chunks are invalidated (Section 12, 14).
 */

import { textToSpeech } from './ntkAi';

export interface SpeechGenerationConfig {
  language: string;
  allowClosestMatch: boolean;
}

export const DEFAULT_SPEECH_CONFIG: SpeechGenerationConfig = {
  language: 'auto',
  allowClosestMatch: false,
};

/**
 * Normalizes speech language codes, mapping legacy regional English (en-US, en-GB)
 * to canonical provider language 'en' (Section 15, 16, 17).
 */
export function normalizeSpeechLanguage(lang?: string | null): string {
  const clean = (lang || 'auto').trim();
  const lower = clean.toLowerCase();
  if (lower === 'en-us' || lower === 'en-gb' || lower === 'en_us' || lower === 'en_gb') {
    return 'en';
  }
  return clean;
}

/**
 * Determines if a configuration change genuinely affects speech synthesis bytes.
 *
 * Section 6, 9, 10:
 * Playback speed is client-side playback only (HTMLAudioElement.playbackRate).
 * Speed NEVER alters speech generation bytes or invalidates cached blobs.
 * Only language changes (after normalization) and allowClosestMatch changes affect bytes.
 */
export function isSynthesisAffectingChange(
  current: SpeechGenerationConfig,
  next: SpeechGenerationConfig
): boolean {
  const currentLang = normalizeSpeechLanguage(current.language);
  const nextLang = normalizeSpeechLanguage(next.language);
  if (currentLang !== nextLang) return true;
  if (current.allowClosestMatch !== next.allowClosestMatch) return true;
  return false;
}

export interface ListenOrchestratorOptions {
  chunks: string[];
  config?: SpeechGenerationConfig;
  fetchChunkAudio?: (
    chunkText: string,
    index: number,
    signal?: AbortSignal,
    config?: SpeechGenerationConfig
  ) => Promise<Blob>;
  onPlaybackChunkChange?: (chunkIndex: number) => void;
  onProgress?: (progress: { current: number; total: number }) => void;
  onError?: (err: Error) => void;
}

export interface ListenOrchestratorState {
  currentPlaybackIndex: number;
  isPlaying: boolean;
  isPreparingAll: boolean;
  prepareProgress: { current: number; total: number } | null;
  blobs: (Blob | null)[];
  config: SpeechGenerationConfig;
}

export class ListenOrchestrator {
  private chunks: string[];
  private config: SpeechGenerationConfig;
  private blobConfig: SpeechGenerationConfig | null = null;
  private fetchChunkAudio: (
    chunkText: string,
    index: number,
    signal?: AbortSignal,
    config?: SpeechGenerationConfig
  ) => Promise<Blob>;
  private blobs: (Blob | null)[];
  private currentPlaybackIndex = 0;
  private isPlaying = false;
  private isPreparingAll = false;
  private prepareProgress: { current: number; total: number } | null = null;

  // Separate controllers for single-chunk playback fetch vs full-note preparation
  private playbackAbortController: AbortController | null = null;
  private prepareAbortController: AbortController | null = null;

  private onPlaybackChunkChange?: (chunkIndex: number) => void;
  private onProgress?: (progress: { current: number; total: number }) => void;
  private onError?: (err: Error) => void;

  constructor(options: ListenOrchestratorOptions) {
    this.chunks = [...options.chunks];
    this.config = options.config ? { ...options.config } : { ...DEFAULT_SPEECH_CONFIG };
    this.fetchChunkAudio =
      options.fetchChunkAudio ||
      (async (chunkText, _idx, signal, config) => {
        const cfg = config || this.config;
        return textToSpeech(
          {
            text: chunkText,
            language: normalizeSpeechLanguage(cfg.language),
            allowClosestMatch: cfg.allowClosestMatch,
            format: 'mp3',
          },
          signal
        );
      });
    this.blobs = new Array(this.chunks.length).fill(null);
    this.onPlaybackChunkChange = options.onPlaybackChunkChange;
    this.onProgress = options.onProgress;
    this.onError = options.onError;
  }

  public getConfig(): SpeechGenerationConfig {
    return { ...this.config };
  }

  public getBlobConfig(): SpeechGenerationConfig | null {
    return this.blobConfig ? { ...this.blobConfig } : null;
  }

  /**
   * Updates synthesis configuration (Section 12, 14).
   * If the change genuinely affects generated audio (e.g. language change),
   * old in-progress synthesis is cancelled and incompatible blobs are cleared.
   * Returns true if blobs were cleared/invalidated.
   */
  public updateConfig(newConfig: SpeechGenerationConfig): boolean {
    const isAffecting = isSynthesisAffectingChange(this.config, newConfig);
    this.config = { ...newConfig };

    if (isAffecting) {
      // 1. Explicitly cancel old in-progress synthesis
      this.stopPlayback({ cancelFullPreparation: true });
      // 2. Clear incompatible generated chunk state
      this.clearBlobs();
      return true;
    }
    return false;
  }

  public clearBlobs(): void {
    this.blobs = new Array(this.chunks.length).fill(null);
    this.blobConfig = null;
  }

  public getState(): ListenOrchestratorState {
    return {
      currentPlaybackIndex: this.currentPlaybackIndex,
      isPlaying: this.isPlaying,
      isPreparingAll: this.isPreparingAll,
      prepareProgress: this.prepareProgress ? { ...this.prepareProgress } : null,
      blobs: [...this.blobs],
      config: { ...this.config },
    };
  }

  public getBlobs(): (Blob | null)[] {
    return [...this.blobs];
  }

  public setBlobs(blobs: (Blob | null)[]): void {
    this.blobs = [...blobs];
  }

  public getChunks(): string[] {
    return [...this.chunks];
  }

  private async doFetch(
    chunkText: string,
    index: number,
    signal?: AbortSignal,
    configSnapshot?: SpeechGenerationConfig
  ): Promise<Blob> {
    const effectiveConfig = configSnapshot || this.config;
    return this.fetchChunkAudio(chunkText, index, signal, effectiveConfig);
  }

  /**
   * Start or advance playback for a specific chunk.
   * Crucial: Cancels only the previous playback fetch, NEVER full preparation.
   */
  public async startPlayback(index: number): Promise<Blob | null> {
    if (index < 0 || index >= this.chunks.length) return null;

    // Stop current playback audio request, but PRESERVE full preparation
    this.stopPlayback({ cancelFullPreparation: false });

    this.currentPlaybackIndex = index;
    this.isPlaying = true;
    this.onPlaybackChunkChange?.(index);

    // Invalidate if existing blobs belong to a previous incompatible config
    if (this.blobConfig && isSynthesisAffectingChange(this.blobConfig, this.config)) {
      this.clearBlobs();
    }

    const controller = new AbortController();
    this.playbackAbortController = controller;

    try {
      let blob = this.blobs[index];
      if (!blob) {
        blob = await this.doFetch(this.chunks[index], index, controller.signal, this.config);
        if (controller.signal.aborted) return null;
        this.blobs[index] = blob;
        this.blobConfig = { ...this.config };
      }
      return blob;
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return null;
      }
      this.isPlaying = false;
      if (err instanceof Error) this.onError?.(err);
      throw err;
    }
  }

  /**
   * Prefetches a chunk into canonical orchestrator state (Section 10).
   * Shares the same blob array used by playback, Save, and Download.
   */
  public async prefetchChunk(index: number): Promise<Blob | null> {
    if (index < 0 || index >= this.chunks.length) return null;
    if (this.blobs[index]) return this.blobs[index];

    // If config was changed, do not prefetch with incompatible state
    if (this.blobConfig && isSynthesisAffectingChange(this.blobConfig, this.config)) {
      return null;
    }

    const configSnapshot = { ...this.config };
    try {
      const blob = await this.doFetch(this.chunks[index], index, undefined, configSnapshot);
      // Discard if config changed while fetching
      if (isSynthesisAffectingChange(this.config, configSnapshot)) {
        return null;
      }
      if (!this.blobs[index]) {
        this.blobs[index] = blob;
        this.blobConfig = { ...configSnapshot };
      }
      return this.blobs[index];
    } catch {
      return null;
    }
  }

  /**
   * Called when the current audio element finishes playing naturally (audio.onended).
   * Advances playback to the next chunk without disturbing full preparation.
   */
  public async handleChunkEnded(): Promise<{ advanced: boolean; nextIndex: number; blob: Blob | null }> {
    const nextIndex = this.currentPlaybackIndex + 1;
    if (nextIndex < this.chunks.length && this.isPlaying) {
      const blob = await this.startPlayback(nextIndex);
      return { advanced: true, nextIndex, blob };
    } else {
      this.isPlaying = false;
      return { advanced: false, nextIndex: this.currentPlaybackIndex, blob: null };
    }
  }

  /**
   * Stop playback.
   * When cancelFullPreparation is false (e.g. automatic chunk transition), preparation continues.
   * When cancelFullPreparation is true (e.g. user clicks Stop, Close, or Cancel), preparation halts.
   */
  public stopPlayback(options?: { cancelFullPreparation?: boolean }): void {
    if (this.playbackAbortController) {
      this.playbackAbortController.abort();
      this.playbackAbortController = null;
    }
    this.isPlaying = false;

    if (options?.cancelFullPreparation) {
      this.cancelPreparation();
    }
  }

  /**
   * Explicitly cancel complete-audio preparation.
   */
  public cancelPreparation(): void {
    if (this.prepareAbortController) {
      this.prepareAbortController.abort();
      this.prepareAbortController = null;
    }
    this.isPreparingAll = false;
    this.prepareProgress = null;
  }

  /**
   * Ensure ALL chunks for the note/selection are synthesized and stored.
   * Section 14: Takes an immutable snapshot of this.config.
   * Every chunk in the final output is guaranteed to use this SAME snapshot.
   */
  public async ensureAllChunksGenerated(): Promise<Blob[] | null> {
    if (!this.chunks.length) return null;

    // Take an immutable configuration snapshot for the entire preparation
    const configSnapshot = { ...this.config };

    // Invalidate existing blobs if they were generated under a different synthesis configuration
    if (this.blobConfig && isSynthesisAffectingChange(this.blobConfig, configSnapshot)) {
      this.clearBlobs();
    }

    // If already complete and compatible, return immediately
    const isComplete = this.chunks.every((_, idx) => !!this.blobs[idx]);
    if (isComplete && this.blobs.length >= this.chunks.length) {
      return this.blobs.slice(0, this.chunks.length) as Blob[];
    }

    if (this.prepareAbortController) {
      this.prepareAbortController.abort();
    }
    const controller = new AbortController();
    this.prepareAbortController = controller;
    this.isPreparingAll = true;

    try {
      for (let i = 0; i < this.chunks.length; i++) {
        if (controller.signal.aborted) return null;

        // If config changed while preparation was running, halt cleanly (Section 14)
        if (isSynthesisAffectingChange(this.config, configSnapshot)) {
          return null;
        }

        const progress = { current: i + 1, total: this.chunks.length };
        this.prepareProgress = progress;
        this.onProgress?.(progress);

        if (!this.blobs[i]) {
          const blob = await this.doFetch(this.chunks[i], i, controller.signal, configSnapshot);
          if (controller.signal.aborted) return null;
          this.blobs[i] = blob;
        }
      }

      this.blobConfig = { ...configSnapshot };
      this.isPreparingAll = false;
      this.prepareProgress = null;
      return this.blobs.slice(0, this.chunks.length) as Blob[];
    } catch (err: unknown) {
      this.isPreparingAll = false;
      this.prepareProgress = null;
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return null;
      }
      if (err instanceof Error) this.onError?.(err);
      throw err;
    }
  }

  /**
   * Produce a single combined audio blob for the entire requested text.
   * Returns null if any chunk is missing.
   */
  public produceCompleteAudioBlob(mimeType = 'audio/mpeg'): Blob | null {
    if (!this.chunks.length) return null;
    const hasAll = this.chunks.every((_, idx) => !!this.blobs[idx]);
    if (!hasAll) return null;

    const fullBlobs = this.blobs.slice(0, this.chunks.length) as Blob[];
    return new Blob(fullBlobs, { type: mimeType });
  }

  /**
   * Executes a full Save: ensures all chunks exist, combines into exactly ONE blob,
   * and invokes the upload callback exactly once.
   */
  public async saveCompleteAudio(
    uploadFn: (combinedBlob: Blob) => Promise<void>,
    mimeType = 'audio/mpeg'
  ): Promise<{ success: boolean; error?: string }> {
    const allBlobs = await this.ensureAllChunksGenerated();
    if (!allBlobs || allBlobs.length < this.chunks.length) {
      return { success: false, error: 'Audio preparation was not complete' };
    }

    const combinedBlob = this.produceCompleteAudioBlob(mimeType);
    if (!combinedBlob) {
      return { success: false, error: 'Failed to combine audio chunks' };
    }

    await uploadFn(combinedBlob);
    return { success: true };
  }

  /**
   * Executes a full Download: ensures all chunks exist, combines into exactly ONE blob,
   * and invokes the download callback. Does NOT upload to storage.
   */
  public async downloadCompleteAudio(
    downloadFn: (combinedBlob: Blob) => void,
    mimeType = 'audio/mpeg'
  ): Promise<{ success: boolean; error?: string }> {
    const allBlobs = await this.ensureAllChunksGenerated();
    if (!allBlobs || allBlobs.length < this.chunks.length) {
      return { success: false, error: 'Audio preparation was not complete' };
    }

    const combinedBlob = this.produceCompleteAudioBlob(mimeType);
    if (!combinedBlob) {
      return { success: false, error: 'Failed to combine audio chunks' };
    }

    downloadFn(combinedBlob);
    return { success: true };
  }
}

/**
 * Calculates accurate duration metadata for single or multi-chunk audio (Section 12, 13).
 * For persistent R2 audio metadata, duration must describe the actual intrinsic MP3 duration.
 * Does NOT scale or divide saved-file duration by the user's temporary playbackRate.
 * If an active speech chunk is measured by HTMLAudioElement, scales proportionally
 * across total text characters. Otherwise uses natural speaking rate (~15 chars/sec).
 */
export function calculateCombinedAudioDuration(options: {
  textLength: number;
  chunkCount: number;
  speed?: number;
  currentChunkDuration?: number | null;
  currentChunkLength?: number | null;
}): number {
  const chunkCount = Math.max(1, options.chunkCount);
  const minDuration = chunkCount * 3;

  if (options.currentChunkDuration && options.currentChunkDuration > 0) {
    if (chunkCount === 1) {
      return Math.round(options.currentChunkDuration);
    }
    if (options.currentChunkLength && options.currentChunkLength > 0) {
      const secondsPerChar = options.currentChunkDuration / options.currentChunkLength;
      return Math.max(minDuration, Math.round(secondsPerChar * options.textLength));
    }
  }

  // Fallback: ~15 chars per second natural speaking rate.
  // Note: Stored R2 duration reflects natural intrinsic recording duration,
  // NOT divided or scaled by client-side playback rate (Section 13, 28).
  return Math.max(minDuration, Math.round(options.textLength / 15));
}
