/**
 * Timezone utilities for LPU Campus Resource Booking Platform.
 * Application timezone is strictly Asia/Kolkata.
 * All database timestamps are persisted in UTC.
 */

export const APP_TIMEZONE = 'Asia/Kolkata';

const DAY_NAME_TO_INT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Returns the day of week (0=Sunday ... 6=Saturday) according to Asia/Kolkata.
 */
export function getDayOfWeekInKolkata(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  });
  const shortName = formatter.format(date);
  return DAY_NAME_TO_INT[shortName] ?? 0;
}

/**
 * Returns "HH:mm" (24-hour time string) in Asia/Kolkata.
 */
export function getTimeStringInKolkata(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
}

/**
 * Returns "YYYY-MM-DD" in Asia/Kolkata.
 */
export function getDateStringInKolkata(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Parses time string like "08:00 AM", "8:30 PM", or "14:00" into minutes from midnight.
 */
export function parseTimeToMinutes(timeStr: string): number {
  const trimmed = timeStr.trim();
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!ampmMatch) {
    return -1;
  }

  let hour = parseInt(ampmMatch[1], 10);
  const minute = parseInt(ampmMatch[2], 10);
  const modifier = ampmMatch[3]?.toUpperCase();

  if (modifier === 'PM' && hour < 12) hour += 12;
  if (modifier === 'AM' && hour === 12) hour = 0;

  return hour * 60 + minute;
}

/**
 * Checks if the booking start and end times fall within the resource's operating hours.
 * Default operating hours: "08:00 AM - 08:00 PM"
 */
export function validateOperatingHours(
  start: Date,
  end: Date,
  operatingHoursStr = '08:00 AM - 08:00 PM'
): { valid: boolean; reason?: string } {
  // Operating hours are defined in local campus time (Asia/Kolkata)
  const parts = operatingHoursStr.split('-');
  if (parts.length !== 2) {
    return { valid: true }; // Fallback if malformed
  }

  const openMinutes = parseTimeToMinutes(parts[0]);
  const closeMinutes = parseTimeToMinutes(parts[1]);

  if (openMinutes === -1 || closeMinutes === -1) {
    return { valid: true };
  }

  const startKolkataStr = getTimeStringInKolkata(start);
  const endKolkataStr = getTimeStringInKolkata(end);

  const startMinutes = parseTimeToMinutes(startKolkataStr);
  const endMinutes = parseTimeToMinutes(endKolkataStr);

  // Check if booking spans across different calendar days in Kolkata
  const startDateStr = getDateStringInKolkata(start);
  const endDateStr = getDateStringInKolkata(end);

  if (startDateStr !== endDateStr) {
    return {
      valid: false,
      reason: 'Single bookings cannot span across multiple calendar days.',
    };
  }

  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    return {
      valid: false,
      reason: `Booking (${startKolkataStr} - ${endKolkataStr}) is outside the facility operating hours (${operatingHoursStr.trim()}).`,
    };
  }

  return { valid: true };
}

/**
 * Validates strict YYYY-MM-DD calendar date.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Validates 24-hour HH:mm time string.
 */
export function isValidTimeString(timeStr: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
}

/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:mm) in Asia/Kolkata to a UTC Date object.
 */
export function kolkataToUtc(dateStr: string, timeStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMillis);
}

/**
 * Returns the start of a given calendar day in Asia/Kolkata as a UTC Date (00:00:00.000 IST).
 */
export function getKolkataDayStartUtc(dateStr: string): Date {
  return kolkataToUtc(dateStr, '00:00');
}

/**
 * Returns the exclusive upper boundary of a given calendar day in Asia/Kolkata as a UTC Date (next day 00:00:00.000 IST).
 */
export function getKolkataDayEndUtc(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDayUtcMillis = Date.UTC(year, month - 1, day + 1, 0, 0) - (5 * 60 + 30) * 60 * 1000;
  return new Date(nextDayUtcMillis);
}

/**
 * Helper to ensure an input is a valid Date object.
 */
function toDate(input: Date | string | number): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    // If it is a bare calendar date (YYYY-MM-DD), parse as Asia/Kolkata noon to prevent local UTC shift
    return kolkataToUtc(input, '12:00');
  }
  return new Date(input);
}

/**
 * Returns current date string in Asia/Kolkata (YYYY-MM-DD).
 */
export function getCurrentKolkataDateString(): string {
  return getDateStringInKolkata(new Date());
}

/**
 * Returns current time string in Asia/Kolkata (HH:mm).
 */
export function getCurrentKolkataTimeString(): string {
  return getTimeStringInKolkata(new Date());
}

/**
 * Adds or subtracts days to a YYYY-MM-DD string in Asia/Kolkata, returning a new YYYY-MM-DD string.
 */
export function addDaysKolkata(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dayOfMonth}`;
}

/**
 * Formats a date in Asia/Kolkata (e.g. "01 Dec 2026" or "Tuesday, 01 Dec 2026").
 */
export function formatKolkataDate(
  dateInput: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(dateInput);
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  };
  return new Intl.DateTimeFormat('en-IN', { ...defaultOptions, ...options }).format(d);
}

/**
 * Formats a time in Asia/Kolkata (e.g. "10:00 AM" or "02:30 PM").
 */
export function formatKolkataTime(dateInput: Date | string | number): string {
  const d = toDate(dateInput);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Formats a full date and time in Asia/Kolkata (e.g. "01 Dec 2026, 10:00 AM").
 */
export function formatKolkataDateTime(dateInput: Date | string | number): string {
  const d = toDate(dateInput);
  const datePart = formatKolkataDate(d);
  const timePart = formatKolkataTime(d);
  return `${datePart}, ${timePart}`;
}

/**
 * Formats a time range in Asia/Kolkata (e.g. "10:00 AM - 11:30 AM").
 */
export function formatKolkataTimeRange(
  startInput: Date | string | number,
  endInput: Date | string | number
): string {
  return `${formatKolkataTime(startInput)} - ${formatKolkataTime(endInput)}`;
}

/**
 * Converts a 24-hour time string ("14:00" or "08:30") to 12-hour format ("02:00 PM" or "08:30 AM").
 */
export function formatSlotTime12Hour(time24: string): string {
  if (!time24) return '';
  const [hourStr, minStr] = time24.split(':');
  let hour = parseInt(hourStr, 10);
  const minute = minStr || '00';
  if (isNaN(hour)) return time24;
  const modifier = hour >= 12 ? 'PM' : 'AM';
  if (hour === 0) hour = 12;
  else if (hour > 12) hour -= 12;
  return `${String(hour).padStart(2, '0')}:${minute} ${modifier}`;
}

/**
 * Formats slot start and end times ("08:00", "08:30") into readable 12-hour range ("08:00 AM - 08:30 AM").
 */
export function formatSlotTimeRange(startTime: string, endTime: string): string {
  return `${formatSlotTime12Hour(startTime)} - ${formatSlotTime12Hour(endTime)}`;
}

/**
 * Weekday enum / string mappings to day-of-week integer (0=Sunday ... 6=Saturday)
 */
export const WEEKDAY_TO_INT: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

export const INT_TO_WEEKDAY: Record<number, string> = {
  0: 'SUNDAY',
  1: 'MONDAY',
  2: 'TUESDAY',
  3: 'WEDNESDAY',
  4: 'THURSDAY',
  5: 'FRIDAY',
  6: 'SATURDAY',
};

/**
 * Computes calendar week start (Monday 00:00:00 IST) and end (Sunday 23:59:59.999 IST) in Asia/Kolkata.
 */
export function getKolkataWeekRange(dateInput: Date | string): {
  weekStartStr: string; // YYYY-MM-DD
  weekEndStr: string;   // YYYY-MM-DD
  weekStartUtc: Date;
  weekEndUtc: Date;
} {
  let dateStr: string;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    dateStr = dateInput;
  } else {
    dateStr = getDateStringInKolkata(dateInput instanceof Date ? dateInput : new Date(dateInput));
  }

  const noonUtc = kolkataToUtc(dateStr, '12:00');
  const dayOfWeek = getDayOfWeekInKolkata(noonUtc); // 0=Sun, 1=Mon, ..., 6=Sat

  // Days since Monday (Monday = 0, Tuesday = 1, ..., Sunday = 6)
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStartStr = addDaysKolkata(dateStr, -daysSinceMonday);
  const weekEndStr = addDaysKolkata(weekStartStr, 6);

  const weekStartUtc = kolkataToUtc(weekStartStr, '00:00');
  const nextMondayUtc = kolkataToUtc(addDaysKolkata(weekEndStr, 1), '00:00');
  const weekEndUtc = new Date(nextMondayUtc.getTime() - 1); // 23:59:59.999 IST

  return {
    weekStartStr,
    weekEndStr,
    weekStartUtc,
    weekEndUtc,
  };
}


