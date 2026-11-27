import {
  isValidDateString,
  isValidTimeString,
  kolkataToUtc,
  addDaysKolkata,
  getDateStringInKolkata,
  getDayOfWeekInKolkata,
  WEEKDAY_TO_INT,
  INT_TO_WEEKDAY,
} from '@/lib/timezone';
import {
  RecurrenceFrequency,
  BookingOccurrence,
  Weekday,
} from '@lpu/shared';
import { ApiError } from '@/lib/auth';

export interface RecurrenceInput {
  startDate: string; // YYYY-MM-DD in Asia/Kolkata
  frequency: RecurrenceFrequency;
  interval?: number; // default 1
  weekdays?: string[]; // e.g. ['MONDAY', 'WEDNESDAY']
  until?: string; // YYYY-MM-DD
  count?: number; // 1 to 16
  timeOfDay: string; // HH:mm
  durationMinutes: number; // in minutes (15 - 480)
}

/**
 * Calculates end time HH:mm given start time HH:mm and duration in minutes.
 */
export function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const totalM = h * 60 + m + minutes;
  const newH = Math.floor(totalM / 60);
  const newM = totalM % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

export class RecurrenceService {
  /**
   * Validates recurrence rules according to R5 business policies.
   */
  static validateRule(input: RecurrenceInput): void {
    if (!input.startDate || !isValidDateString(input.startDate)) {
      throw new ApiError(400, 'Invalid startDate format. Expected YYYY-MM-DD.');
    }

    if (!input.timeOfDay || !isValidTimeString(input.timeOfDay)) {
      throw new ApiError(400, 'Invalid timeOfDay format. Expected HH:mm.');
    }

    if (
      !input.durationMinutes ||
      isNaN(input.durationMinutes) ||
      input.durationMinutes < 15 ||
      input.durationMinutes > 480
    ) {
      throw new ApiError(400, 'Duration must be between 15 minutes and 480 minutes (8 hours).');
    }

    const interval = input.interval !== undefined ? Number(input.interval) : 1;
    if (isNaN(interval) || interval < 1 || interval > 52) {
      throw new ApiError(400, 'Recurrence interval must be an integer between 1 and 52.');
    }

    if (input.frequency !== 'DAILY' && input.frequency !== 'WEEKLY') {
      throw new ApiError(400, 'Frequency must be either DAILY or WEEKLY.');
    }

    // End condition validation: exactly one of until or count must be provided
    const hasUntil = Boolean(input.until);
    const hasCount = input.count !== undefined && input.count !== null;

    if (!hasUntil && !hasCount) {
      throw new ApiError(400, 'Recurrence termination condition required: specify either "until" date or occurrence "count".');
    }

    if (hasUntil && hasCount) {
      throw new ApiError(400, 'Ambiguous recurrence termination: specify either "until" date or occurrence "count", not both.');
    }

    if (hasCount) {
      const count = Number(input.count);
      if (isNaN(count) || !Number.isInteger(count) || count < 1) {
        throw new ApiError(400, 'Occurrence count must be a positive whole number.');
      }
      if (count > 16) {
        throw new ApiError(400, 'Occurrence count exceeds maximum allowed limit of 16 occurrences.');
      }
    }

    if (hasUntil) {
      if (!isValidDateString(input.until!)) {
        throw new ApiError(400, 'Invalid until date format. Expected YYYY-MM-DD.');
      }
      if (input.until! < input.startDate) {
        throw new ApiError(400, 'Recurrence end date (until) cannot precede starting date (startDate).');
      }
    }

    // Weekly recurrence validation
    if (input.frequency === 'WEEKLY') {
      if (!input.weekdays || !Array.isArray(input.weekdays) || input.weekdays.length === 0) {
        throw new ApiError(400, 'Weekly recurrence requires at least one selected weekday.');
      }

      for (const day of input.weekdays) {
        const upper = String(day).toUpperCase();
        if (WEEKDAY_TO_INT[upper] === undefined) {
          throw new ApiError(400, `Invalid weekday: ${day}. Expected MONDAY, TUESDAY, etc.`);
        }
      }
    }
  }

  /**
   * Deterministically generates all occurrence dates and times in Asia/Kolkata timezone.
   * Enforces max 16 occurrences limit.
   */
  static generateOccurrences(input: RecurrenceInput): BookingOccurrence[] {
    this.validateRule(input);

    const interval = input.interval !== undefined ? Number(input.interval) : 1;
    const targetCount = input.count !== undefined ? Number(input.count) : undefined;
    const untilDate = input.until;

    const occurrences: BookingOccurrence[] = [];
    const maxOccurrences = 16;

    const [sH, sM] = input.timeOfDay.split(':').map(Number);
    const totalMinutes = sH * 60 + sM + input.durationMinutes;
    if (totalMinutes > 24 * 60) {
      throw new ApiError(400, 'Booking slot cannot cross past midnight into the next calendar day.');
    }
    const endTime = addMinutesToTime(input.timeOfDay, input.durationMinutes);

    if (input.frequency === 'DAILY') {
      let currentDate = input.startDate;
      let iteration = 0;
      const maxIterations = 365;

      while (iteration < maxIterations) {
        iteration++;

        if (untilDate && currentDate > untilDate) {
          break;
        }

        const startUtc = kolkataToUtc(currentDate, input.timeOfDay);
        const endUtc = kolkataToUtc(currentDate, endTime);

        occurrences.push({
          date: currentDate,
          startTime: input.timeOfDay,
          endTime,
          durationMinutes: input.durationMinutes,
          sequenceNumber: occurrences.length + 1,
          startUtc: startUtc.toISOString(),
          endUtc: endUtc.toISOString(),
        });

        if (targetCount && occurrences.length >= targetCount) {
          break;
        }

        if (occurrences.length > maxOccurrences) {
          throw new ApiError(
            400,
            `Recurrence rule produces more than the maximum limit of ${maxOccurrences} occurrences. Please shorten the end date or reduce occurrence count.`
          );
        }

        currentDate = addDaysKolkata(currentDate, interval);
      }
    } else if (input.frequency === 'WEEKLY') {
      // Normalize weekdays into day numbers (0=Sun, 1=Mon, ..., 6=Sat)
      const selectedDayNumbers = new Set<number>();
      for (const w of input.weekdays || []) {
        const val = WEEKDAY_TO_INT[String(w).toUpperCase()];
        if (val !== undefined) selectedDayNumbers.add(val);
      }

      // Find the Monday of the start date's week
      const startNoonUtc = kolkataToUtc(input.startDate, '12:00');
      const startDayOfWeek = getDayOfWeekInKolkata(startNoonUtc);
      const daysSinceMonday = (startDayOfWeek + 6) % 7;
      let currentWeekMonday = addDaysKolkata(input.startDate, -daysSinceMonday);

      let weekIndex = 0;
      const maxWeeks = 52;

      while (weekIndex < maxWeeks) {
        weekIndex++;

        // Days in this week: Monday through Sunday (offset 0 to 6)
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
          const candidateDate = addDaysKolkata(currentWeekMonday, dayOffset);

          // Do not generate dates before startDate
          if (candidateDate < input.startDate) {
            continue;
          }

          if (untilDate && candidateDate > untilDate) {
            break;
          }

          const candNoonUtc = kolkataToUtc(candidateDate, '12:00');
          const candDayOfWeek = getDayOfWeekInKolkata(candNoonUtc);

          if (selectedDayNumbers.has(candDayOfWeek)) {
            const startUtc = kolkataToUtc(candidateDate, input.timeOfDay);
            const endUtc = kolkataToUtc(candidateDate, endTime);

            occurrences.push({
              date: candidateDate,
              startTime: input.timeOfDay,
              endTime,
              durationMinutes: input.durationMinutes,
              sequenceNumber: occurrences.length + 1,
              startUtc: startUtc.toISOString(),
              endUtc: endUtc.toISOString(),
            });

            if (targetCount && occurrences.length >= targetCount) {
              break;
            }

            if (occurrences.length > maxOccurrences) {
              throw new ApiError(
                400,
                `Recurrence rule produces more than the maximum limit of ${maxOccurrences} occurrences. Please shorten the end date or reduce occurrence count.`
              );
            }
          }
        }

        if (targetCount && occurrences.length >= targetCount) {
          break;
        }

        if (untilDate && currentWeekMonday > untilDate) {
          break;
        }

        // Advance to next active week according to weekly interval
        currentWeekMonday = addDaysKolkata(currentWeekMonday, interval * 7);
      }
    }

    if (occurrences.length === 0) {
      throw new ApiError(
        400,
        'Recurrence rule produced 0 occurrences. Ensure the selected weekdays and end date overlap valid calendar dates.'
      );
    }

    if (occurrences.length > maxOccurrences) {
      throw new ApiError(
        400,
        `Recurrence rule exceeds the maximum allowed limit of ${maxOccurrences} occurrences (produced ${occurrences.length}).`
      );
    }

    return occurrences;
  }
}
