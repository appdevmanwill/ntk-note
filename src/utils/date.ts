import { format } from 'date-fns';

export const getLordsDayName = (date: Date): string => {
  // Check if date is Sunday (getDay() === 0)
  if (date.getDay() !== 0) return '';
  
  const year = date.getFullYear();
  const month = date.getMonth();
  
  // Find all Sundays in this month
  const sundays: Date[] = [];
  const tempDate = new Date(year, month, 1);
  while (tempDate.getMonth() === month) {
    if (tempDate.getDay() === 0) {
      sundays.push(new Date(tempDate));
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }
  
  // Find the index of the current date in the sundays list
  const idx = sundays.findIndex(s => s.getDate() === date.getDate());
  if (idx === -1) return '';
  
  const total = sundays.length;
  if (total === 5) {
    const names = ["Sellusia", "Rhumani", "Lajuji", "Sabitona", "Sellina"];
    return names[idx] ? `${names[idx]} Lordsday` : "Lordsday";
  } else {
    // total === 4
    const names = ["Sellusia", "Rhumani", "Lajuji", "Sellina"];
    return names[idx] ? `${names[idx]} Lordsday` : "Lordsday";
  }
};

export const formatSelectedDate = (date: Date): string => {
  const lordsDayName = getLordsDayName(date);
  if (lordsDayName) {
    return `${lordsDayName}, ${format(date, 'MMM d, yyyy')}`;
  }
  return format(date, 'EEEE, MMM d, yyyy');
};

export const formatDashboardDate = (date: Date): string => {
  const lordsDayName = getLordsDayName(date);
  if (lordsDayName) {
    return `${lordsDayName}, ${format(date, 'MMMM d, yyyy')}`;
  }
  return format(date, 'EEEE, MMMM d, yyyy');
};
