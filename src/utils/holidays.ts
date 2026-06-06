

export interface Holiday {
  name: string;
  type: 'universal' | 'NG' | 'UK' | 'US' | 'BCG';
  flag: string;
}

interface FixedHoliday {
  month: number;
  date: number;
  name: string;
}

// Meeus/Jones/Butcher algorithm to calculate Easter Sunday for any year
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Helper to calculate Nth occurrences of a day of the week
function getNthDayOfWeek(year: number, month: number, dayOfWeek: number, n: number): Date {
  if (n > 0) {
    const date = new Date(year, month, 1);
    let count = 0;
    while (date.getMonth() === month) {
      if (date.getDay() === dayOfWeek) {
        count++;
        if (count === n) {
          return new Date(date);
        }
      }
      date.setDate(date.getDate() + 1);
    }
  } else {
    // Last occurrence (n = -1)
    const date = new Date(year, month + 1, 0); // Last day of the month
    while (date.getMonth() === month) {
      if (date.getDay() === dayOfWeek) {
        return new Date(date);
      }
      date.setDate(date.getDate() - 1);
    }
  }
  throw new Error('Invalid Nth day of week');
}

const berachahChurchFixedEvents: FixedHoliday[] = [
  { month: 0, date: 1, name: 'Power Day - First Manifested Anointing of Daddy Aronah Ashammah' },
  { month: 0, date: 5, name: 'Key of Physical Miracles Given to Mummy Seria and the Seven Women' },
  { month: 0, date: 15, name: 'End of the Nigerian Civil War' },
  { month: 1, date: 26, name: 'Rod of Authority Given to Mummy Aaroh Seria' },
  { month: 2, date: 3, name: 'Anniversary of the Glorious Church' },
  { month: 2, date: 17, name: 'Spiritual Leadership Handed Over to the Woman' },
  { month: 3, date: 6, name: 'Sellusia Unity Day' },
  { month: 4, date: 5, name: 'Seria and Ashammah Day' },
  { month: 4, date: 30, name: 'Declaration of Secession by Former Eastern Nigeria' },
  { month: 5, date: 1, name: 'Eve of Atonement Day' },
  { month: 5, date: 2, name: 'Atonement Day' },
  { month: 5, date: 6, name: 'Liberty Day' },
  { month: 5, date: 7, name: 'Visitation Day' },
  { month: 5, date: 8, name: 'Thanksgiving Day' },
  { month: 5, date: 14, name: 'Women Liberation Day' },
  { month: 5, date: 19, name: "Mummy Seria's Birthday" },
  { month: 5, date: 29, name: 'New Covenant with the Senior Sellina' },
  { month: 6, date: 9, name: 'Rally Day for Glorification Day' },
  { month: 6, date: 11, name: 'Glorification Day Rejoicing, Singing and Dancing - Day 1' },
  { month: 6, date: 12, name: 'Glorification Day Rejoicing, Singing and Dancing - Day 2' },
  { month: 6, date: 13, name: 'Glorification Day Rejoicing, Singing and Dancing - Day 3' },
  { month: 6, date: 15, name: 'Full Hand-Over of Pacesetter Women Ministry to Women' },
  { month: 6, date: 16, name: 'Glorification Day' },
  { month: 6, date: 18, name: 'God Chose Mummy Seria as Head Pastor of Berachah Church of God' },
  { month: 6, date: 24, name: 'Birthday of the First Minento of the Glorious Church' },
  { month: 6, date: 27, name: 'Mama Abiye (Ruth Alfred) Birthday' },
  { month: 6, date: 31, name: 'Sellina Tribe Receive Power in Full' },
  { month: 7, date: 7, name: 'Eli Gave Full Authority to Sellusiaites' },
  { month: 7, date: 20, name: 'Sellusia Covenant Day - Day 1' },
  { month: 7, date: 21, name: 'Sellusia Covenant Day - Day 2' },
  { month: 7, date: 22, name: 'Sellusia Covenant Day - Day 3' },
  { month: 7, date: 28, name: 'Women Reconciliation Day' },
  { month: 8, date: 2, name: 'Welcome Songs to the Willing One' },
  { month: 8, date: 9, name: 'Welcome Day' },
  { month: 8, date: 10, name: 'Welcome Day Continuation' },
  { month: 9, date: 19, name: "Jesus' Dedication" },
  { month: 10, date: 10, name: 'Ashammah, the Unamba Day' },
  { month: 10, date: 16, name: "The Day God Accepted Aaroh's Price" },
  { month: 10, date: 28, name: 'Mummy Aaroh Call to Glory' },
  { month: 11, date: 8, name: 'The Day of Great Joy' },
  { month: 11, date: 14, name: 'Igbo Day (Emancipation Day)' },
  { month: 11, date: 29, name: 'God Took Over the Leadership of Sellina Land' },
];

function addBerachahChurchEvents(holidays: Holiday[], month: number, date: number) {
  berachahChurchFixedEvents.forEach(event => {
    if (event.month === month && event.date === date) {
      holidays.push({ name: event.name, type: 'BCG', flag: 'BCG' });
    }
  });
}

export function getHolidaysForDate(date: Date): Holiday[] {
  const holidays: Holiday[] = [];
  const y = date.getFullYear();
  const m = date.getMonth(); // 0-indexed
  const d = date.getDate();

  // 1. UNIVERSAL/GLOBAL FIXED HOLIDAYS
  const universalFixed = [
    { month: 0, date: 1, name: "New Year's Day" },
    { month: 1, date: 14, name: "Valentine's Day" },
    { month: 2, date: 8, name: "International Women's Day" },
    { month: 3, date: 22, name: "Earth Day" },
    { month: 9, date: 31, name: "Halloween" },
    { month: 11, date: 24, name: "Christmas Eve" },
    { month: 11, date: 25, name: "Christmas Day" },
    { month: 11, date: 26, name: "Boxing Day" },
    { month: 11, date: 31, name: "New Year's Eve" }
  ];

  universalFixed.forEach(h => {
    if (h.month === m && h.date === d) {
      holidays.push({ name: h.name, type: 'universal', flag: '🌐' });
    }
  });

  // Universal Dynamic
  // Mother's Day: 2nd Sunday of May
  const mothersDay = getNthDayOfWeek(y, 4, 0, 2);
  if (m === 4 && d === mothersDay.getDate()) {
    holidays.push({ name: "Mother's Day", type: 'universal', flag: '🌐' });
  }

  // Father's Day: 3rd Sunday of June
  const fathersDay = getNthDayOfWeek(y, 5, 0, 3);
  if (m === 5 && d === fathersDay.getDate()) {
    holidays.push({ name: "Father's Day", type: 'universal', flag: '🌐' });
  }

  // 2. NIGERIA FIXED & MOVING HOLIDAYS
  const nigeriaFixed = [
    { month: 0, date: 1, name: "New Year's Day" },
    { month: 4, date: 1, name: "Workers' Day" },
    { month: 4, date: 27, name: "Children's Day" },
    { month: 5, date: 12, name: "Democracy Day" },
    { month: 9, date: 1, name: "Independence Day" },
    { month: 11, date: 25, name: "Christmas Day" },
    { month: 11, date: 26, name: "Boxing Day" }
  ];

  nigeriaFixed.forEach(h => {
    if (h.month === m && h.date === d) {
      if (!holidays.some(uh => uh.name === h.name)) {
        holidays.push({ name: h.name, type: 'NG', flag: '🇳🇬' });
      }
    }
  });

  // Nigerian moving Islamic holidays (2025–2028)
  const islamicHolidays: { [key: number]: { month: number; date: number; name: string }[] } = {
    2025: [
      { month: 2, date: 31, name: "Eid al-Fitr" },
      { month: 5, date: 6, name: "Eid al-Adha" },
      { month: 8, date: 4, name: "Mawlid (Eid al-Maulud)" }
    ],
    2026: [
      { month: 2, date: 19, name: "Eid al-Fitr" },
      { month: 2, date: 20, name: "Eid al-Fitr (Day 2)" },
      { month: 4, date: 27, name: "Eid al-Adha" },
      { month: 4, date: 28, name: "Eid al-Adha (Day 2)" },
      { month: 7, date: 26, name: "Mawlid (Eid al-Maulud)" }
    ],
    2027: [
      { month: 2, date: 9, name: "Eid al-Fitr" },
      { month: 2, date: 10, name: "Eid al-Fitr (Day 2)" },
      { month: 4, date: 16, name: "Eid al-Adha" },
      { month: 4, date: 17, name: "Eid al-Adha (Day 2)" },
      { month: 7, date: 15, name: "Mawlid (Eid al-Maulud)" }
    ],
    2028: [
      { month: 1, date: 26, name: "Eid al-Fitr" },
      { month: 1, date: 27, name: "Eid al-Fitr (Day 2)" },
      { month: 4, date: 5, name: "Eid al-Adha" },
      { month: 4, date: 6, name: "Eid al-Adha (Day 2)" },
      { month: 7, date: 4, name: "Mawlid (Eid al-Maulud)" }
    ]
  };

  if (islamicHolidays[y]) {
    islamicHolidays[y].forEach(h => {
      if (h.month === m && h.date === d) {
        holidays.push({ name: h.name, type: 'NG', flag: '🇳🇬' });
      }
    });
  }

  // 3. UNITED KINGDOM HOLIDAYS
  const ukFixed = [
    { month: 0, date: 1, name: "New Year's Day" },
    { month: 11, date: 25, name: "Christmas Day" },
    { month: 11, date: 26, name: "Boxing Day" }
  ];

  ukFixed.forEach(h => {
    if (h.month === m && h.date === d) {
      if (!holidays.some(uh => uh.name === h.name)) {
        holidays.push({ name: h.name, type: 'UK', flag: '🇬🇧' });
      }
    }
  });

  // UK Dynamic Bank Holidays
  // Early May Bank Holiday: 1st Monday of May
  const earlyMayBank = getNthDayOfWeek(y, 4, 1, 1);
  if (m === 4 && d === earlyMayBank.getDate()) {
    holidays.push({ name: "Early May Bank Holiday", type: 'UK', flag: '🇬🇧' });
  }

  // Spring Bank Holiday: last Monday of May
  const springBank = getNthDayOfWeek(y, 4, 1, -1);
  if (m === 4 && d === springBank.getDate()) {
    holidays.push({ name: "Spring Bank Holiday", type: 'UK', flag: '🇬🇧' });
  }

  // Summer Bank Holiday: last Monday of August
  const summerBank = getNthDayOfWeek(y, 7, 1, -1);
  if (m === 7 && d === summerBank.getDate()) {
    holidays.push({ name: "Summer Bank Holiday", type: 'UK', flag: '🇬🇧' });
  }

  // 4. UNITED STATES HOLIDAYS
  const usFixed = [
    { month: 0, date: 1, name: "New Year's Day" },
    { month: 5, date: 19, name: "Juneteenth" },
    { month: 6, date: 4, name: "Independence Day" },
    { month: 10, date: 11, name: "Veterans Day" },
    { month: 11, date: 25, name: "Christmas Day" }
  ];

  usFixed.forEach(h => {
    if (h.month === m && h.date === d) {
      if (!holidays.some(uh => uh.name === h.name)) {
        holidays.push({ name: h.name, type: 'US', flag: '🇺🇸' });
      }
    }
  });

  // US Dynamic Holidays
  // MLK Day: 3rd Monday of January
  const mlkDay = getNthDayOfWeek(y, 0, 1, 3);
  if (m === 0 && d === mlkDay.getDate()) {
    holidays.push({ name: "Martin Luther King Jr. Day", type: 'US', flag: '🇺🇸' });
  }

  // Presidents' Day (Washington's Birthday): 3rd Monday of February
  const presidentsDay = getNthDayOfWeek(y, 1, 1, 3);
  if (m === 1 && d === presidentsDay.getDate()) {
    holidays.push({ name: "Presidents' Day / Washington's Birthday", type: 'US', flag: '🇺🇸' });
  }

  // Memorial Day: last Monday of May
  const memorialDay = getNthDayOfWeek(y, 4, 1, -1);
  if (m === 4 && d === memorialDay.getDate()) {
    holidays.push({ name: "Memorial Day", type: 'US', flag: '🇺🇸' });
  }

  // Labor Day: 1st Monday of September
  const laborDay = getNthDayOfWeek(y, 8, 1, 1);
  if (m === 8 && d === laborDay.getDate()) {
    holidays.push({ name: "Labor Day", type: 'US', flag: '🇺🇸' });
  }

  // Columbus Day: 2nd Monday of October
  const columbusDay = getNthDayOfWeek(y, 9, 1, 2);
  if (m === 9 && d === columbusDay.getDate()) {
    holidays.push({ name: "Columbus Day / Indigenous Peoples' Day", type: 'US', flag: '🇺🇸' });
  }

  // Thanksgiving: 4th Thursday of November
  const thanksgiving = getNthDayOfWeek(y, 10, 4, 4);
  if (m === 10 && d === thanksgiving.getDate()) {
    holidays.push({ name: "Thanksgiving Day", type: 'US', flag: '🇺🇸' });
  }

  // 5. EASTER-BASED MOVING CHRISTIAN HOLIDAYS
  const easterSunday = getEasterSunday(y);
  // Good Friday is 2 days before Easter
  const goodFriday = new Date(easterSunday);
  goodFriday.setDate(easterSunday.getDate() - 2);
  // Easter Monday is 1 day after Easter
  const easterMonday = new Date(easterSunday);
  easterMonday.setDate(easterSunday.getDate() + 1);

  if (m === goodFriday.getMonth() && d === goodFriday.getDate()) {
    holidays.push({ name: "Good Friday", type: 'universal', flag: '🌐' });
  }
  if (m === easterMonday.getMonth() && d === easterMonday.getDate()) {
    holidays.push({ name: "Easter Monday", type: 'universal', flag: '🌐' });
  }

  // 6. BERACHAH CHURCH OF GOD / GLORIOUS CHURCH CALENDAR
  const firstSellusiaLordsday = getNthDayOfWeek(y, 0, 0, 1);
  if (m === 0 && d === firstSellusiaLordsday.getDate()) {
    holidays.push({
      name: "Sellusiaites' Covenant of Spotless Unity",
      type: 'BCG',
      flag: 'BCG',
    });
  }
  addBerachahChurchEvents(holidays, m, d);

  return holidays;
}
