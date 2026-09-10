import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, RotateCcw, Sparkles, X, MessageSquare } from 'lucide-react';
import { requestNtkAi, type AiTask, type AiWritingStyle } from '@/utils/ntkAi';
import { useStore } from '@/store';
import FriendlyAiOutput, { sanitizeAiText } from './FriendlyAiOutput';

const actions: Array<{ task: AiTask; label: string; hint: string }> = [
  { task: 'improve', label: 'Improve writing', hint: 'Make it clearer and smoother' },
  { task: 'grammar', label: 'Fix grammar', hint: 'Correct grammar and spelling' },
  { task: 'professional', label: 'Make professional', hint: 'Use a polished professional tone' },
  { task: 'simplify', label: 'Make simpler', hint: 'Make it easier to understand' },
  { task: 'shorten', label: 'Shorten', hint: 'Keep the meaning, remove extra words' },
  { task: 'expand', label: 'Expand', hint: 'Add useful detail without padding' },
  { task: 'summarize', label: 'Summarize', hint: 'Pull out the key points' },
  { task: 'checklist', label: 'Turn into checklist', hint: 'Convert into practical steps' },
  { task: 'actions', label: 'Extract action items', hint: 'Find what needs to be done' },
  { task: 'brainstorm', label: 'Brainstorm ideas', hint: 'Suggest useful next ideas' },
  { task: 'explain', label: 'Explain this', hint: 'Explain it in plain language' },
  { task: 'continue', label: 'Continue writing', hint: 'Suggest a natural continuation' },
];

export default function NtkAiPanel({
  open,
  onClose,
  noteTitle,
  noteContent,
  selectedText,
  writingStyle,
  onReplaceSelection,
  onInsertBelow,
  onReplaceNote,
}: {
  open: boolean;
  onClose: () => void;
  noteTitle: string;
  noteContent: string;
  selectedText: string;
  writingStyle: AiWritingStyle;
  onReplaceSelection: (text: string) => void;
  onInsertBelow: (text: string) => void;
  onReplaceNote: (text: string) => void;
}) {
  const { settings } = useStore();
  const [task, setTask] = useState<AiTask>('improve');
  const [instruction, setInstruction] = useState('');
  const [scope, setScope] = useState<'selection' | 'note'>(selectedText.trim() ? 'selection' : 'note');
  const [wholeNoteApproved, setWholeNoteApproved] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sourceText = useMemo(() => scope === 'selection' && selectedText.trim() ? selectedText : noteContent, [scope, selectedText, noteContent]);

  useEffect(() => {
    if (!open) return;
    const preferred = selectedText.trim() && settings.aiDefaultScope === 'selection' ? 'selection' : 'note';
    setScope(preferred);
    setWholeNoteApproved(!settings.aiConfirmWholeNote || preferred === 'selection');
    setStatus('');
    setResult('');
  }, [open, selectedText, settings.aiDefaultScope, settings.aiConfirmWholeNote]);

  if (!open) return null;

  const run = async () => {
    if (!sourceText.trim()) {
      setStatus('Add some text first, then ask NTK AI to help.');
      return;
    }
    if (scope === 'note' && settings.aiConfirmWholeNote && !wholeNoteApproved) {
      setStatus('Choose “Use this note” below so you know exactly what NTK AI will use.');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setResult('');
    setStatus('Getting your answer ready…');
    try {
      await requestNtkAi({ task, text: sourceText, noteTitle, noteContext: scope === 'selection' ? noteContent.slice(0, 5000) : undefined, instruction: instruction.trim() || undefined, writingStyle }, {
        onStatus: setStatus,
        onDelta: delta => setResult(previous => previous + delta),
      }, controller.signal);
      setStatus('Ready for you to review.');
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus(result ? 'Stopped. You can keep what arrived, copy it, or try again.' : 'Stopped. Nothing in your note was changed.');
      } else {
        const msg = error instanceof Error ? error.message : "NTK AI is temporarily unavailable, so I stopped trying rather than keep you waiting. Your note is unchanged.";
        setStatus(result ? `${msg} You can keep what arrived, copy it, or try again.` : msg);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/35 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="NTK AI">
      <div className="theme-menu flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border sm:rounded-3xl">
        <div className="flex items-center justify-between border-b theme-divider px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl ai-orb text-white shadow-lg"><Sparkles className="h-5 w-5" /></span>
            <div><h2 className="font-extrabold text-theme-primary">NTK AI</h2><p className="text-xs text-theme-tertiary">Your note stays unchanged until you choose to apply a suggestion.</p></div>
          </div>
          <button onClick={() => { abortRef.current?.abort(); onClose(); }} className="rounded-xl p-2 theme-hover text-theme-secondary" aria-label="Close NTK AI"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {selectedText.trim() && <button onClick={() => { setScope('selection'); setWholeNoteApproved(true); }} className={`rounded-full px-3 py-1.5 text-xs font-bold ${scope === 'selection' ? 'accent-button' : 'theme-muted-surface text-theme-secondary'}`}>Selected text</button>}
              <button onClick={() => { setScope('note'); setWholeNoteApproved(!settings.aiConfirmWholeNote); }} className={`rounded-full px-3 py-1.5 text-xs font-bold ${scope === 'note' ? 'accent-button' : 'theme-muted-surface text-theme-secondary'}`}>Whole note</button>
            </div>
            <button
              type="button"
              onClick={() => {
                useStore.getState().setAiNoteContext({
                  noteId: '',
                  noteTitle,
                  noteContent: sourceText.slice(0, 4000),
                });
                useStore.getState().setCurrentView('ai');
                onClose();
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border theme-border theme-hover text-theme-secondary"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat about this note</span>
            </button>
          </div>

          {scope === 'note' && settings.aiConfirmWholeNote && !wholeNoteApproved && (
            <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><p className="text-sm font-bold text-theme-primary">Use this note for this request?</p><p className="mt-1 text-xs leading-5 text-theme-tertiary">NTK AI will use the note text to prepare your answer. It will not scan other notes or change this one automatically.</p></div>
              <button type="button" onClick={() => setWholeNoteApproved(true)} className="shrink-0 rounded-xl accent-button px-4 py-2 text-xs font-bold">Use this note</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {actions.map(action => (
              <button key={action.task} type="button" onClick={() => setTask(action.task)} className={`rounded-2xl border p-3 text-left transition-all ${task === action.task ? 'accent-border accent-soft' : 'theme-border theme-card theme-hover'}`}>
                <p className="text-sm font-bold text-theme-primary">{action.label}</p>
                <p className="mt-1 text-[11px] leading-4 text-theme-tertiary">{action.hint}</p>
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-bold text-theme-secondary">Anything specific?</span>
            <textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={2} className="w-full resize-none rounded-2xl border theme-input accent-focus px-3 py-2.5 text-sm outline-none" placeholder="Optional — e.g. keep the Nigerian context, make it warmer, keep it under 120 words…" />
          </label>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border theme-border px-3 py-3 theme-soft-panel">
            <div className="min-w-0"><p className="text-sm font-semibold text-theme-primary">{status || 'Choose what you want NTK AI to do.'}</p><p className="mt-0.5 text-xs text-theme-tertiary">If one AI service is unavailable, NTK Note can move to another automatically.</p></div>
            <button type="button" onClick={running ? () => abortRef.current?.abort() : run} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold ${running ? 'border theme-border theme-hover text-theme-secondary' : 'accent-button'}`}>
              {running ? 'Stop' : result ? 'Try again' : 'Generate'}
            </button>
          </div>

          {result && (
            <div className="mt-4 overflow-hidden rounded-2xl border theme-border theme-card">
              <div className="flex items-center justify-between border-b theme-divider px-4 py-2.5">
                <span className="text-xs font-bold uppercase tracking-wide text-theme-tertiary">Suggestion</span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(sanitizeAiText(result));
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold theme-hover text-theme-secondary"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto px-4 py-4">
                <FriendlyAiOutput content={result} />
              </div>
              <div className="flex flex-wrap gap-2 border-t theme-divider px-4 py-3">
                {scope === 'selection' && selectedText.trim() && (
                  <button onClick={() => { onReplaceSelection(sanitizeAiText(result)); onClose(); }} className="rounded-xl accent-button px-3 py-2 text-xs font-bold">
                    Replace selection
                  </button>
                )}
                <button onClick={() => { onInsertBelow(sanitizeAiText(result)); onClose(); }} className="rounded-xl border theme-border theme-hover px-3 py-2 text-xs font-bold text-theme-secondary">
                  Insert below
                </button>
                <button onClick={() => { onReplaceNote(sanitizeAiText(result)); onClose(); }} className="rounded-xl border theme-border theme-hover px-3 py-2 text-xs font-bold text-theme-secondary">
                  Use as note
                </button>
                <button onClick={() => void run()} className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold accent-text theme-hover">
                  <RotateCcw className="h-3.5 w-3.5" />Try another
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
