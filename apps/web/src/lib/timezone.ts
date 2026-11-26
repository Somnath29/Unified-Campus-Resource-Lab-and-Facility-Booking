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

