import { useState } from 'react';
import { useStore } from '@/store';
import { ChevronLeft, ChevronRight, Bell } from 'lucide-react';
import { 
  startOfMonth, endOfMonth, eachDayOfInterval, format, 
  isSameDay, isToday, getDay, addMonths, subMonths 
} from 'date-fns';
import { getHolidaysForDate, type Holiday } from '@/utils/holidays';
import { formatSelectedDate } from '@/utils/date';

const holidayTypeLabels: Record<Holiday['type'], string> = {
  universal: 'Universal Celebration',
  NG: 'Nigeria Public Holiday',
  UK: 'UK Holiday',
  US: 'US Federal Holiday',
  BCG: 'Berachah Church Calendar',
};

export default function CalendarWidget() {
  const { notes } = useStore();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart);
  
  const reminders = notes
    .filter(n => n.reminder && n.reminder.time && !n.trashed)
    .map(n => ({ date: new Date(n.reminder!.time), title: n.title }))
    .filter(r => !isNaN(r.date.getTime()));

  const monthReminders = reminders.filter(r => 
    r.date.getMonth() === currentMonth.getMonth() && 
    r.date.getFullYear() === currentMonth.getFullYear()
  );

  const selectedDayReminders = reminders.filter(r => isSameDay(r.date, selectedDate));
  const selectedDayHolidays = getHolidaysForDate(selectedDate);
  
  return (
    <div className="rounded-xl theme-card border overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b theme-divider flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-orange-500 no-transition" />
          <h3 className="font-semibold text-theme-primary text-sm">Calendar</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1 rounded-lg theme-hover cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronLeft className="w-4 h-4 no-transition" />
          </button>
          <span className="text-sm font-medium text-theme-secondary px-2 min-w-[120px] text-center select-none">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1 rounded-lg theme-hover cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronRight className="w-4 h-4 no-transition" />
          </button>
        </div>
      </div>
      
      {/* Day Labels */}
      <div className="grid grid-cols-7 px-3 pt-2 flex-shrink-0 select-none">
        {['LO', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} className="text-[10px] font-bold text-center py-1" style={{ color: 'var(--text-muted)' }}>
            {d}
          </div>
        ))}
      </div>
      
      {/* Days Grid */}
      <div className="grid grid-cols-7 px-3 pb-2.5 border-b theme-divider flex-shrink-0">
        {/* Empty cells for alignment */}
        {Array.from({ length: startDayOfWeek }).map((_, i) => (
          <div key={`empty-${i}`} className="h-8" />
        ))}
        
        {days.map(day => {
          const hasReminder = monthReminders.some(r => isSameDay(r.date, day));
          const dayHolidays = getHolidaysForDate(day);
          const hasHoliday = dayHolidays.length > 0;
          const today = isToday(day);
          const isSelected = isSameDay(day, selectedDate);
          
          return (
            <div key={day.toISOString()} className="flex items-center justify-center h-8">
              <button
                onClick={() => setSelectedDate(day)}
                className={`
                  w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold relative transition-all duration-75 cursor-pointer
                  ${today ? 'text-white' : ''}
                  ${isSelected ? 'ring-2 ring-[var(--accent-primary)] font-bold' : ''}
                  ${!today && !isSelected ? 'hover:bg-[var(--hover-bg)]' : ''}
                `}
                style={
                  today 
                    ? { backgroundColor: 'var(--accent-primary)' } 
                    : isSelected 
                      ? { color: 'var(--text-primary)' } 
                      : { color: 'var(--text-secondary)' }
                }
              >
                {format(day, 'd')}
                
                {/* Micro indicators for reminders and holidays */}
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {hasReminder && (
                    <span 
                      className="rounded-full bg-orange-500" 
                      style={{ width: '3.5px', height: '3.5px' }} 
                    />
                  )}
                  {hasHoliday && (
                    <span 
                      className="rounded-full bg-indigo-500 dark:bg-indigo-400" 
                      style={{ width: '3.5px', height: '3.5px' }} 
                    />
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
      
      {/* Selected Day Details Panel */}
      <div className="flex-1 overflow-y-auto px-4 py-3 bg-[var(--app-bg-subtle)]/20 min-h-[140px] max-h-[220px]">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[10px] font-bold uppercase tracking-wider select-none" style={{ color: 'var(--text-muted)' }}>
            {formatSelectedDate(selectedDate)}
          </h4>
          {(selectedDayHolidays.length > 0 || selectedDayReminders.length > 0) && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide accent-soft select-none">
              {[
                selectedDayHolidays.length > 0 ? `${selectedDayHolidays.length} celebration${selectedDayHolidays.length > 1 ? 's' : ''}` : '',
                selectedDayReminders.length > 0 ? `${selectedDayReminders.length} reminder${selectedDayReminders.length > 1 ? 's' : ''}` : ''
              ].filter(Boolean).join(' • ')}
            </span>
          )}
        </div>
        
        <div className="space-y-1.5">
          {/* Holidays */}
          {selectedDayHolidays.map((holiday, i) => (
            <div key={`h-${i}`} className="flex items-center gap-2.5 p-2 rounded-lg bg-[var(--card-bg)] border theme-divider shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.04)]">
              <span className="text-base select-none leading-none">{holiday.flag}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-theme-primary leading-tight truncate">{holiday.name}</span>
                <span className="text-[9px] text-theme-tertiary font-bold tracking-wide uppercase mt-0.5">
                  {holidayTypeLabels[holiday.type]}
                </span>
              </div>
            </div>
          ))}

          {/* Reminders */}
          {selectedDayReminders.map((r, i) => (
            <div key={`r-${i}`} className="flex items-center gap-2.5 p-2 rounded-lg bg-[var(--card-bg)] border border-orange-500/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.04)]">
              <Bell className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-theme-secondary leading-tight truncate">{r.title || 'Untitled Note'}</span>
                <span className="text-[9px] text-theme-muted font-bold tracking-wide uppercase mt-0.5">
                  Reminder set for {format(r.date, 'p')}
                </span>
              </div>
            </div>
          ))}

          {/* Empty State */}
          {selectedDayHolidays.length === 0 && selectedDayReminders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-center select-none">
              <p className="text-xs text-theme-muted italic">
                No holidays or reminders on this day.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
