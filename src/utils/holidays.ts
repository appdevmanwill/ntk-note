

export interface Holiday {
  name: string;
  type: 'universal' | 'NG' | 'UK' | 'US' | 'BCG';
  flag: string;
  summary: string;
}

interface FixedHoliday {
  month: number;
  date: number;
  name: string;
  summary: string;
}

const holidaySummaries: Record<string, string> = {
  "New Year's Day": 'Marks the first day of the Gregorian calendar year, a time for reflection, fresh intentions, family gatherings, and public celebrations around the world.',
  "Valentine's Day": 'A day for expressing affection and appreciation through greetings, gifts, friendship, and romantic gestures.',
  "International Women's Day": 'A global observance celebrating women and girls, while calling attention to equal rights, opportunity, safety, and empowerment.',
  'Earth Day': 'A worldwide environmental action day that began with the modern environmental movement in 1970 and now focuses on protecting the planet.',
  'Halloween': 'A cultural celebration on the eve of All Saints Day, shaped by older Samhain traditions and now known for costumes, lanterns, treats, and playful spooky customs.',
  'Christmas Eve': 'The evening before Christmas Day, often marked by worship services, family gatherings, carols, and preparation for the Nativity celebration.',
  'Christmas Day': 'A Christian celebration of the birth of Jesus Christ, also widely observed as a season of family, generosity, goodwill, worship, and festive traditions.',
  'Boxing Day': 'A December 26 holiday in the UK and Commonwealth tradition, historically linked to gifts for workers and the poor and now also associated with rest, shopping, and sport.',
  "New Year's Eve": 'The final night of the year, commonly marked with countdowns, gatherings, thanksgiving, reflection, and celebrations that welcome the new year.',
  "Mother's Day": 'Honors mothers and mother figures for their care and influence, commonly through cards, flowers, family meals, and personal appreciation.',
  "Father's Day": 'Honors fathers and father figures for their care, sacrifice, guidance, and contribution to family life.',
  "Workers' Day": 'Recognizes workers and labor solidarity on May 1, connecting modern public holidays with the global movement for fair work and dignity.',
  "Children's Day": 'A Nigerian observance that celebrates children while drawing attention to child rights, protection, education, health, and welfare.',
  'Democracy Day': 'Nigeria marks June 12 to remember the democratic struggle around the 1993 presidential election and to recommit to representative government.',
  'NG:Independence Day': 'Nigeria commemorates October 1, 1960, when the country became independent from British rule, with reflection on unity, freedom, and nation-building.',
  'Eid al-Fitr': 'An Islamic festival marking the end of Ramadan, centered on communal prayer, charity, gratitude, family visits, meals, and renewed fellowship.',
  'Eid al-Adha': 'The Islamic Festival of Sacrifice, linked to the Hajj season and Abrahamic obedience, marked by prayer, sacrifice, sharing food, charity, and family gathering.',
  'Mawlid (Eid al-Maulud)': 'Commemorates the birth of the Prophet Muhammad in communities that observe it, often with devotional gatherings, teaching, processions, charity, and praise.',
  'Early May Bank Holiday': 'A UK public holiday on the first Monday of May, giving workers a long weekend often used for rest, civic events, and community activity.',
  'Spring Bank Holiday': 'A late-May UK public holiday that creates a long weekend near the start of summer for rest, travel, and community events.',
  'Summer Bank Holiday': 'A late-August UK public holiday often treated as the closing long weekend of summer before schools and work routines resume.',
  'Martin Luther King Jr. Day': 'A US federal holiday honoring Dr. King and the civil rights movement, widely observed through remembrance, education, and community service.',
  "Presidents' Day / Washington's Birthday": 'A US federal holiday legally honoring George Washington, now commonly used to recognize Washington, Lincoln, and presidential leadership more broadly.',
  'Memorial Day': 'A US federal holiday for mourning and honoring military personnel who died while serving, rooted in post-Civil War Decoration Day traditions.',
  'Juneteenth': 'Commemorates freedom and emancipation, especially the June 19, 1865 announcement in Galveston, Texas, that enslaved African Americans there were free.',
  'US:Independence Day': 'The United States commemorates July 4, 1776, when the Declaration of Independence announced the separation of the thirteen colonies from Great Britain.',
  'Labor Day': 'A US holiday honoring workers and their contributions to society, rooted in the late nineteenth-century labor movement and now observed on the first Monday in September.',
  "Columbus Day / Indigenous Peoples' Day": 'A US October observance that federally remains Columbus Day while many places also use the day to honor Indigenous peoples, cultures, sovereignty, and historical truth.',
  'Veterans Day': 'A US holiday on November 11 honoring all military veterans, originally tied to the World War I armistice and now focused on service and sacrifice.',
  'Thanksgiving Day': 'A US national holiday centered on gratitude, family gathering, and a shared meal, shaped by harvest thanksgiving traditions and national observance.',
  'Good Friday': 'The Friday before Easter, observed by Christians as the commemoration of the crucifixion and death of Jesus Christ.',
  'Easter Monday': 'The day after Easter Sunday, observed in many places as a continuation of Easter celebration, rest, worship, and family gathering.',
};

function getHolidaySummary(name: string, type: Holiday['type']): string {
  const typedSummary = holidaySummaries[`${type}:${name}`];
  if (typedSummary) return typedSummary;

  const normalizedName = name.replace(/ \(Day \d+\)$/u, '');
  return holidaySummaries[normalizedName] || holidaySummaries[name] || 'A calendar celebration or public observance for this date.';
}

function createHoliday(name: string, type: Holiday['type'], flag: string, summary?: string): Holiday {
  return {
    name,
    type,
    flag,
    summary: summary || getHolidaySummary(name, type),
  };
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
  {
    month: 0,
    date: 1,
    name: 'Power Day - First Manifested Anointing of Daddy Aronah Ashammah',
    summary: 'Commemorates January 1, 1993, when Daddy Aronah Ashammah Godwin Immanuel first manifested anointing as a minister of God; the day is remembered as Power Day.',
  },
  {
    month: 0,
    date: 5,
    name: 'Key of Physical Miracles Given to Mummy Seria and the Seven Women',
    summary: 'Marks January 5, 2005, when the church received the announcement that authority for physical miracles had been given to Mummy Seria and the seven women.',
  },
  {
    month: 0,
    date: 15,
    name: 'End of the Nigerian Civil War',
    summary: "Remembers January 15, 1970, when the Nigerian Civil War ended; in the BCG calendar it is a thanksgiving day for God's intervention and restoration.",
  },
  {
    month: 1,
    date: 26,
    name: 'Rod of Authority Given to Mummy Aaroh Seria',
    summary: 'Commemorates February 26, 2012, when Eli gave Mummy Aaroh Seria the Rod of Authority, described as the rod of Jesus, victory, and miracles.',
  },
  {
    month: 2,
    date: 3,
    name: 'Anniversary of the Glorious Church',
    summary: 'Marks March 3, 1993, when Berachah Church of God, the beginning of the Glorious Church, was founded through God direction to Team Ten.',
  },
  {
    month: 2,
    date: 17,
    name: 'Spiritual Leadership Handed Over to the Woman',
    summary: 'Commemorates March 17, 2002, when Mummy Seria was made Spiritual Leader of the Glorious Church and women received the spiritual leadership role.',
  },
  {
    month: 3,
    date: 6,
    name: 'Sellusia Unity Day',
    summary: 'Remembers April 6, 2003, when God united Sellusiaites and taught them to swallow bitterness, reject division, and live as one people.',
  },
  {
    month: 4,
    date: 5,
    name: 'Seria and Ashammah Day',
    summary: 'Commemorates the wedding of Mummy Seria and Daddy Ashammah, with ministration for couples, homes, pregnancies, safe deliveries, and family blessings.',
  },
  {
    month: 4,
    date: 30,
    name: 'Declaration of Secession by Former Eastern Nigeria',
    summary: 'Remembers May 30, 1967, when former Eastern Nigeria declared secession; Sellusiaites use the day soberly to thank God for deliverance from a grievous mistake.',
  },
  {
    month: 5,
    date: 1,
    name: 'On The Way To Calvary',
    summary: 'A preparatory celebration before Atonement Day, remembering the journey toward Calvary as Immanuel Women decorate the arena, rejoice over Christ victory, and prepare with music and dancing.',
  },
  {
    month: 5,
    date: 2,
    name: 'Atonement Day',
    summary: 'Commemorates the crucifixion of Jesus Christ and the atonement for mankind, with praises, worship, and thanksgiving for the victory of the Cross.',
  },
  {
    month: 5,
    date: 6,
    name: 'Liberty Day',
    summary: 'Celebrates the resurrection of Jesus Christ and the liberty He gave the world, especially the liberation of women from bondage and slavishness.',
  },
  {
    month: 5,
    date: 7,
    name: 'Visitation Day',
    summary: 'A day of feasting with the Trinity after the resurrection of Jesus Christ, remembered as a joyful visitation and fellowship celebration.',
  },
  {
    month: 5,
    date: 8,
    name: 'Thanksgiving Day',
    summary: 'A thanksgiving celebration for the atonement of mankind sins and Jesus victory over death, marked with praise, worship, and joyful dancing.',
  },
  {
    month: 5,
    date: 14,
    name: 'Women Liberation Day',
    summary: 'Commemorates June 14, 1997, when God liberated women from the bondage of Satan and the oppression of men.',
  },
  {
    month: 5,
    date: 19,
    name: "Mummy Seria's Birthday",
    summary: 'Celebrates the birthday of Mummy Seria Abyssinia Sasia Aaroh Immanuel, honoring her as a mother and blessing to the Glorious Church.',
  },
  {
    month: 5,
    date: 29,
    name: 'New Covenant with the Senior Sellina',
    summary: 'Marks the day God entered a new covenant with the Senior Sellina, remembered with rainbow hats and thanksgiving for covenant blessing.',
  },
  {
    month: 6,
    date: 9,
    name: 'Rally Day for Glorification Day',
    summary: 'A preparation rally seven days before Glorification Day, with women dancing, singing, carrying timbrels, giving gifts, and rejoicing in anticipation.',
  },
  {
    month: 6,
    date: 11,
    name: 'Glorification Day Rejoicing, Singing and Dancing - Day 1',
    summary: 'The first of three days of rejoicing, singing, and dancing that leads into the celebration of Glorification Day.',
  },
  {
    month: 6,
    date: 12,
    name: 'Glorification Day Rejoicing, Singing and Dancing - Day 2',
    summary: 'The second day of rejoicing, singing, and dancing in preparation for Glorification Day.',
  },
  {
    month: 6,
    date: 13,
    name: 'Glorification Day Rejoicing, Singing and Dancing - Day 3',
    summary: 'The third day of rejoicing, singing, and dancing before Glorification Day.',
  },
  {
    month: 6,
    date: 15,
    name: 'Full Hand-Over of Pacesetter Women Ministry to Women',
    summary: 'Commemorates July 15, 2004, when Pacesetter Women Ministry was handed fully to women and women were charged to excel where men failed.',
  },
  {
    month: 6,
    date: 16,
    name: 'Glorification Day',
    summary: 'Marks the ascension of Jesus Christ after forty days from His resurrection, when He was received in heaven, crowned, and given the full glory of His office.',
  },
  {
    month: 6,
    date: 18,
    name: 'God Chose Mummy Seria as Head Pastor of Berachah Church of God',
    summary: 'Commemorates July 18, 2004, when God chose Mummy Seria as Head Pastor of Berachah Church of God and women celebrated the final handover.',
  },
  {
    month: 6,
    date: 24,
    name: 'Birthday of the First Minento of the Glorious Church',
    summary: 'Marks the 1998 birth of Miss Ebun-Oluwa Immanuel, the first Minento and Full Light of the Glorious Church.',
  },
  {
    month: 6,
    date: 27,
    name: 'Mama Abiye (Ruth Alfred) Birthday',
    summary: 'Celebrates Mama Abiye Ruth Alfred birthday, with children and mothers from her time dressing well and being honored in parade.',
  },
  {
    month: 6,
    date: 31,
    name: 'Sellina Tribe Receive Power in Full',
    summary: 'Remembers July 31, 2005, when the Sellina tribe received power in full, with joy, thanksgiving, feasting, gifts, and care for the needy.',
  },
  {
    month: 7,
    date: 7,
    name: 'Eli Gave Full Authority to Sellusiaites',
    summary: 'Commemorates August 7, 2005, when Eli gave full authority to Sellusiaites and Ashammah family celebrates by feeding the church on behalf of Jesus.',
  },
  {
    month: 7,
    date: 20,
    name: 'Sellusia Covenant Day - Day 1',
    summary: 'The first day of Sellusia Covenant Day, remembering the covenant God made with Sellusiaites in 2000 and the name Sellusia, God of All Solution.',
  },
  {
    month: 7,
    date: 21,
    name: 'Sellusia Covenant Day - Day 2',
    summary: 'The second day of Sellusia Covenant celebration, described as a day of power, healing, mercy, elevations, pronouncements, gifts, and thanksgiving.',
  },
  {
    month: 7,
    date: 22,
    name: 'Sellusia Covenant Day - Day 3',
    summary: 'The third day of Sellusia Covenant celebration, continuing the feasting, dancing, covenant remembrance, and public honor of Sellusiaites.',
  },
  {
    month: 7,
    date: 28,
    name: 'Women Reconciliation Day',
    summary: 'Commemorates August 28, 2002, when Jesus reconciled the women of the Glorious Church with God and Daddy Ashammah, removing bitterness and sorrow.',
  },
  {
    month: 8,
    date: 2,
    name: 'Welcome Songs to the Willing One',
    summary: 'A seven-days-before-Welcome-Day carol service given in 2017, with songs, women dances, joyful dressing, small chops, drinks, and thanksgiving.',
  },
  {
    month: 8,
    date: 9,
    name: 'Welcome Day',
    summary: 'Celebrates the birthday of Jesus Christ, the Willing One, as a day of spiritual elevation, miracles, feasting, ministration, songs, and greetings.',
  },
  {
    month: 8,
    date: 10,
    name: 'Welcome Day Continuation',
    summary: 'Continues the celebration of Jesus Christ birth with feasting, gifts, and welcoming the poor and needy into homes for service and care.',
  },
  {
    month: 9,
    date: 19,
    name: "Jesus' Dedication",
    summary: 'Commemorates Jesus dedication forty days after His birth, recognized in the BCG calendar as part of the extended Welcome Day season.',
  },
  {
    month: 10,
    date: 10,
    name: 'Ashammah, the Unamba Day',
    summary: 'Celebrates the birthday of Daddy Ashammah, the Unamba of the Glorious Church, with women-led celebration and Sellina and Sellusia music.',
  },
  {
    month: 10,
    date: 16,
    name: "The Day God Accepted Aaroh's Price",
    summary: 'Commemorates November 16, 2019, when God accepted Aaroh price, with thanksgiving, praise, white-and-gold dressing, and remembrance of her sacrifice.',
  },
  {
    month: 10,
    date: 28,
    name: 'Mummy Aaroh Call to Glory',
    summary: "Marks November 28, 2012, when Mummy Aaroh Seria Abyssinia Sasia Immanuel was called to glory to receive power and anointing for women's role.",
  },
  {
    month: 11,
    date: 8,
    name: 'The Day of Great Joy',
    summary: 'Remembers the 2012 laying in state of the Head Pastor and the declaration that the price had been paid and women were qualified to set the world free.',
  },
  {
    month: 11,
    date: 14,
    name: 'Igbo Day (Emancipation Day)',
    summary: "Celebrates the emancipation of the Igbos, or Saayeites, and God's proclamation of Enugu Opi as the spiritual headquarters of the Glorious Church.",
  },
  {
    month: 11,
    date: 29,
    name: 'God Took Over the Leadership of Sellina Land',
    summary: 'Commemorates December 29, 2006, when Eli Adonai and Jesus used Mummy Aaroh Seria to free Sellina land from evil spiritual bondage.',
  },
];

function addBerachahChurchEvents(holidays: Holiday[], month: number, date: number) {
  berachahChurchFixedEvents.forEach(event => {
    if (event.month === month && event.date === date) {
      holidays.push(createHoliday(event.name, 'BCG', 'BCG', event.summary));
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
      holidays.push(createHoliday(h.name, 'universal', '🌐'));
    }
  });

  // Universal Dynamic
  // Mother's Day: 2nd Sunday of May
  const mothersDay = getNthDayOfWeek(y, 4, 0, 2);
  if (m === 4 && d === mothersDay.getDate()) {
    holidays.push(createHoliday("Mother's Day", 'universal', '🌐'));
  }

  // Father's Day: 3rd Sunday of June
  const fathersDay = getNthDayOfWeek(y, 5, 0, 3);
  if (m === 5 && d === fathersDay.getDate()) {
    holidays.push(createHoliday("Father's Day", 'universal', '🌐'));
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
        holidays.push(createHoliday(h.name, 'NG', '🇳🇬'));
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
        holidays.push(createHoliday(h.name, 'NG', '🇳🇬'));
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
        holidays.push(createHoliday(h.name, 'UK', '🇬🇧'));
      }
    }
  });

  // UK Dynamic Bank Holidays
  // Early May Bank Holiday: 1st Monday of May
  const earlyMayBank = getNthDayOfWeek(y, 4, 1, 1);
  if (m === 4 && d === earlyMayBank.getDate()) {
    holidays.push(createHoliday("Early May Bank Holiday", 'UK', '🇬🇧'));
  }

  // Spring Bank Holiday: last Monday of May
  const springBank = getNthDayOfWeek(y, 4, 1, -1);
  if (m === 4 && d === springBank.getDate()) {
    holidays.push(createHoliday("Spring Bank Holiday", 'UK', '🇬🇧'));
  }

  // Summer Bank Holiday: last Monday of August
  const summerBank = getNthDayOfWeek(y, 7, 1, -1);
  if (m === 7 && d === summerBank.getDate()) {
    holidays.push(createHoliday("Summer Bank Holiday", 'UK', '🇬🇧'));
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
        holidays.push(createHoliday(h.name, 'US', '🇺🇸'));
      }
    }
  });

  // US Dynamic Holidays
  // MLK Day: 3rd Monday of January
  const mlkDay = getNthDayOfWeek(y, 0, 1, 3);
  if (m === 0 && d === mlkDay.getDate()) {
    holidays.push(createHoliday("Martin Luther King Jr. Day", 'US', '🇺🇸'));
  }

  // Presidents' Day (Washington's Birthday): 3rd Monday of February
  const presidentsDay = getNthDayOfWeek(y, 1, 1, 3);
  if (m === 1 && d === presidentsDay.getDate()) {
    holidays.push(createHoliday("Presidents' Day / Washington's Birthday", 'US', '🇺🇸'));
  }

  // Memorial Day: last Monday of May
  const memorialDay = getNthDayOfWeek(y, 4, 1, -1);
  if (m === 4 && d === memorialDay.getDate()) {
    holidays.push(createHoliday("Memorial Day", 'US', '🇺🇸'));
  }

  // Labor Day: 1st Monday of September
  const laborDay = getNthDayOfWeek(y, 8, 1, 1);
  if (m === 8 && d === laborDay.getDate()) {
    holidays.push(createHoliday("Labor Day", 'US', '🇺🇸'));
  }

  // Columbus Day: 2nd Monday of October
  const columbusDay = getNthDayOfWeek(y, 9, 1, 2);
  if (m === 9 && d === columbusDay.getDate()) {
    holidays.push(createHoliday("Columbus Day / Indigenous Peoples' Day", 'US', '🇺🇸'));
  }

  // Thanksgiving: 4th Thursday of November
  const thanksgiving = getNthDayOfWeek(y, 10, 4, 4);
  if (m === 10 && d === thanksgiving.getDate()) {
    holidays.push(createHoliday("Thanksgiving Day", 'US', '🇺🇸'));
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
    holidays.push(createHoliday("Good Friday", 'universal', '🌐'));
  }
  if (m === easterMonday.getMonth() && d === easterMonday.getDate()) {
    holidays.push(createHoliday("Easter Monday", 'universal', '🌐'));
  }

  // 6. BERACHAH CHURCH OF GOD / GLORIOUS CHURCH CALENDAR
  const firstSellusiaLordsday = getNthDayOfWeek(y, 0, 0, 1);
  if (m === 0 && d === firstSellusiaLordsday.getDate()) {
    holidays.push(createHoliday(
      "Sellusiaites' Covenant of Spotless Unity",
      'BCG',
      'BCG',
      'A first Sellusia Lordsday celebration of spotless unity, with representatives bound together in white cloth, white apparel, gift-sharing, and a unity meal.'
    ));
  }
  addBerachahChurchEvents(holidays, m, d);

  return holidays;
}
