import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '@/store';

interface ScratchPadProps {
  className?: string;
}

export default function ScratchPad({ className = '' }: ScratchPadProps) {
  const { scratchPad, updateScratchPad, settings, uid } = useStore();
  const [draft, setDraft] = useState(scratchPad || '');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef = useRef(false);
  const draftRef = useRef(draft);

  // Keep draftRef current
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Reconcile external store updates (e.g. on sync or account change) when NOT actively focused
  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(scratchPad || '');
    }
  }, [scratchPad, uid]);

  // Flush unsaved draft to store
  const flushDraft = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    updateScratchPad(draftRef.current);
  }, [updateScratchPad]);

  // Handle typing: local draft immediate, store debounced
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    setDraft(nextValue);
    draftRef.current = nextValue;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      updateScratchPad(nextValue);
      debounceTimerRef.current = null;
    }, 500);
  };

  const handleFocus = () => {
    isFocusedRef.current = true;
  };

  const handleBlur = () => {
    isFocusedRef.current = false;
    flushDraft();
  };

  // Ensure draft is saved if user closes tab or navigates
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushDraft();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushDraft();
    };
  }, [flushDraft]);

  return (
    <div className={`overflow-hidden rounded-2xl border theme-border theme-card ${className}`}>
      <div className="flex items-center gap-2 border-b theme-divider px-4 py-3">
        <Sparkles className="h-4 w-4 text-amber-500 no-transition" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-theme-primary">Scratch Pad</h2>
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="Quick capture — jot down anything..."
        className="h-36 w-full resize-none bg-transparent px-4 py-3 text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none"
        spellCheck={settings.spellCheck}
        aria-label="Scratch pad"
      />
    </div>
  );
}
