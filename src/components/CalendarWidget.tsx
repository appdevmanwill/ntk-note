import { useState } from 'react';
import { useStore } from '@/store';
import { ChevronLeft, ChevronRight, Bell } from 'lucide-react';
import { 
  startOfMonth, endOfMonth, eachDayOfInterval, format, 
  isSameDay, isToday, getDay, addMonths, subMonths 
} from 'date-fns';

export default function CalendarWidget() {
  const { notes } = useStore();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);
  
  const reminders = notes
    .filter(n => n.reminder && !n.trashed)
    .map(n => ({ date: new Date(n.reminder!.time), title: n.title }))
    .filter(r => r.date.getMonth() === currentMonth.getMonth() && r.date.getFullYear() === currentMonth.getFullYear());
  
  return (
    <div className="rounded-xl theme-card border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-orange-500 no-transition" />
          <h3 className="font-semibold text-theme-primary text-sm">Calendar</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1 rounded-lg theme-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronLeft className="w-4 h-4 no-transition" />
          </button>
          <span className="text-sm font-medium text-theme-secondary px-2 min-w-[120px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1 rounded-lg theme-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronRight className="w-4 h-4 no-transition" />
          </button>
        </div>
      </div>
      
      {/* Day Labels */}
      <div className="grid grid-cols-7 px-3 pt-2">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-[10px] font-semibold text-center py-1" style={{ color: 'var(--text-muted)' }}>
            {d}
          </div>
        ))}
      </div>
      
      {/* Days Grid */}
      <div className="grid grid-cols-7 px-3 pb-3">
        {/* Empty cells for alignment */}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}
        
        {days.map(day => {
          const hasReminder = reminders.some(r => isSameDay(r.date, day));
          const today = isToday(day);
          
          return (
            <div key={day.toISOString()} className="flex items-center justify-center h-8">
              <div className={`
                w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium relative
                ${today ? 'text-white' : ''}
              `}
                style={today ? { backgroundColor: 'var(--accent-primary)' } : { color: 'var(--text-secondary)' }}
              >
                {format(day, 'd')}
                {hasReminder && (
                  <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-orange-500" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Upcoming Reminders */}
      {reminders.length > 0 && (
        <div className="px-3 pb-3 border-t theme-divider pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Reminders
          </p>
          {reminders.slice(0, 3).map((r, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />
              <span className="text-xs truncate text-theme-secondary">{r.title || 'Untitled'}</span>
              <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                {format(r.date, 'MMM d')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
