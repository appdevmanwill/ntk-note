import { useState } from 'react';
import { useStore } from '@/store';
import { X, ChevronRight, Check } from 'lucide-react';

export default function OnboardingGuide() {
  const { settings, updateSettings } = useStore();
  const [step, setStep] = useState(0);

  if (settings.hasSeenTour) return null;

  const steps = [
    {
      title: 'Welcome to NTK Note',
      description: 'Start simple: write a note, make a checklist, or set a reminder. You can discover the more advanced tools later.',
    },
    {
      title: 'Use a template when you want a head start',
      description: 'Templates now show you a preview first. Pick one, give the note a useful name, and NTK Note adds friendly prompts you can edit or delete.',
    },
    {
      title: 'Find things without memorizing where you put them',
      description: 'Use search when you are unsure. Notebooks, tags, starred notes, and reminders are there when you want more organization.',
    },
    {
      title: 'Sync is automatic — and you also have a Sync button',
      description: 'When you are signed in and online, changes sync automatically. If you go offline, safe changes stay on your device and can sync after you reconnect.',
    },
    {
      title: 'Share only when you choose to',
      description: 'Your normal notes start private. You can share a note with a registered user and choose whether they can view, comment, or edit it.',
    },
  ];

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      updateSettings({ hasSeenTour: true });
    }
  };

  const handleSkip = () => {
    updateSettings({ hasSeenTour: true });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div 
        className="w-full max-w-md rounded-2xl shadow-2xl border theme-card relative overflow-hidden animate-in fade-in zoom-in duration-300"
        style={{ backgroundColor: 'var(--app-bg)', borderColor: 'var(--card-border)' }}
      >
        <button 
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 rounded-full theme-hover text-theme-tertiary transition-colors"
          aria-label="Close welcome guide"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <span className="text-3xl text-indigo-500 font-bold">N</span>
            </div>
          </div>
          
          <h2 className="text-2xl font-bold text-center text-theme-primary mb-2">
            {steps[step].title}
          </h2>
          <p className="text-center text-theme-secondary mb-8 leading-relaxed">
            {steps[step].description}
          </p>

          <div className="flex items-center justify-between mt-8">
            <div className="flex gap-2">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === step ? 'bg-indigo-500 w-4' : 'bg-indigo-500/20'
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSkip}
                className="px-4 py-2 text-sm font-medium text-theme-tertiary hover:text-theme-primary transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
              >
                {step === steps.length - 1 ? (
                  <>Get Started <Check className="w-4 h-4" /></>
                ) : (
                  <>Next <ChevronRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
