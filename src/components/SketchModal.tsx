import { useRef, useState, useEffect } from 'react';
import { X, Undo, Trash2, Eraser, Edit2, Check } from 'lucide-react';

interface SketchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

export default function SketchModal({ isOpen, onClose, onSave }: SketchModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Small timeout to allow the modal to render and measure the container
      const timer = setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          canvas.width = rect.width || 700;
          canvas.height = rect.height || 400;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
          }
          setHistory([canvas.toDataURL()]);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getCoords = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // Touch events
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }

    // Mouse events
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL();
      setHistory(prev => [...prev, dataUrl]);
    }
  };

  const startDrawing = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Save state before drawing
    saveToHistory();

    const coords = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);

    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isEraser) {
      ctx.strokeStyle = '#ffffff';
    } else {
      ctx.strokeStyle = color;
    }

    setIsDrawing(true);
  };

  const draw = (e: any) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getCoords(e);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const prevHistory = history.slice(0, -1);
    const lastState = prevHistory[prevHistory.length - 1];

    const canvas = canvasRef.current;
    if (canvas && lastState) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = lastState;
      }
    }
    setHistory(prevHistory);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      saveToHistory();
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      onSave(dataUrl);
      onClose();
    }
  };

  const colors = [
    '#000000', // Black
    '#4b5563', // Gray
    '#ef4444', // Red
    '#f97316', // Orange
    '#f59e0b', // Yellow
    '#10b981', // Green
    '#3b82f6', // Blue
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#ec4899', // Pink
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-[var(--card-bg)] border theme-border rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-theme-primary">Whiteboard Sketchpad</h3>
            <span className="text-xs text-theme-tertiary">(Saved inline in your note body)</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary"
            aria-label="Close whiteboard"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-gray-100 p-4 flex items-center justify-center relative min-h-[300px] overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="border border-gray-200 rounded-xl shadow-inner w-full h-[400px] cursor-crosshair bg-white touch-none"
          />
        </div>

        {/* Drawing Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[var(--app-bg-subtle)]/40 border-t theme-divider">
          <div className="flex items-center gap-3">
            {/* Tool Toggles */}
            <div className="flex items-center gap-1 bg-[var(--card-bg)] border theme-border rounded-lg p-1">
              <button
                onClick={() => setIsEraser(false)}
                className={`p-1.5 rounded-md transition-colors ${!isEraser ? 'accent-soft text-[var(--accent-primary)]' : 'text-theme-tertiary'}`}
                title="Brush tool"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsEraser(true)}
                className={`p-1.5 rounded-md transition-colors ${isEraser ? 'accent-soft text-[var(--accent-primary)]' : 'text-theme-tertiary'}`}
                title="Eraser tool"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>

            {/* Brush Size */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-secondary font-medium">Size:</span>
              <input
                type="range"
                min="1"
                max="20"
                value={brushSize}
                onChange={e => setBrushSize(parseInt(e.target.value))}
                className="w-24 accent-range"
              />
              <span className="text-xs text-theme-tertiary font-mono w-4">{brushSize}px</span>
            </div>

            {/* Colors */}
            {!isEraser && (
              <div className="flex items-center gap-1.5">
                {colors.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full border transition-transform hover:scale-110 flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? 'var(--accent-primary)' : 'rgba(0,0,0,0.1)',
                      borderWidth: color === c ? '2px' : '1px',
                    }}
                    title={c}
                  >
                    {color === c && (
                      <Check className="w-3.5 h-3.5" style={{ color: c === '#ffffff' || c === '#f59e0b' ? '#000000' : '#ffffff' }} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleUndo}
              disabled={history.length <= 1}
              className="p-1.5 rounded-lg border theme-border theme-hover text-theme-secondary disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 text-sm font-medium"
              title="Undo last stroke"
            >
              <Undo className="w-4 h-4" />
              Undo
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg border border-red-200 dark:border-red-950/40 text-red-600 hover:bg-red-500/10 flex items-center gap-1 text-sm font-medium"
              title="Clear all canvas content"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        {/* Modal Save/Close Actions */}
        <div className="flex justify-end gap-3 p-4 bg-[var(--card-bg)] border-t theme-divider">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border theme-border theme-hover text-theme-secondary text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl accent-button text-sm font-semibold flex items-center gap-1.5"
          >
            Insert Drawing
          </button>
        </div>

      </div>
    </div>
  );
}
