import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { BookingStatus } from '@prisma/client';
import {
  isValidDateString,
  getKolkataDayStartUtc,
  getKolkataDayEndUtc,
  getDayOfWeekInKolkata,
  parseTimeToMinutes,
  kolkataToUtc,
} from '@/lib/timezone';
import {
  AvailabilitySlot,
  AvailabilitySlotStatus,
  ResourceAvailabilityResponse,
} from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatMinutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const { id } = params;
    const { searchParams } = new URL(request.url);

    const dateParam = searchParams.get('date');
    if (!dateParam) {
      return fail(400, 'The date query parameter (YYYY-MM-DD) is required.');
    }

    if (!isValidDateString(dateParam)) {
      return fail(400, 'Invalid date format. Expected a valid YYYY-MM-DD calendar date.');
    }

    // 1. Fetch Resource
    const resource = await prisma.resource.findUnique({
      where: { id },
      include: {
        // Timetable entries on the target day of week
      },
    });

    if (!resource || resource.deletedAt !== null) {
      return fail(404, 'Resource not found or has been archived.');
    }

    // 2. Day Boundaries in Asia/Kolkata mapped to UTC
    const dayStartUtc = getKolkataDayStartUtc(dateParam);
    const dayEndUtc = getKolkataDayEndUtc(dateParam);
    const dayOfWeekKolkata = getDayOfWeekInKolkata(dayStartUtc);

    // 3. Operating Hours (Asia/Kolkata)
    const opHours = resource.operatingHours || '08:00 AM - 08:00 PM';
    const opParts = opHours.split('-');
    let openMinutes = 8 * 60; // 08:00
    let closeMinutes = 20 * 60; // 20:00

    if (opParts.length === 2) {
      const parsedOpen = parseTimeToMinutes(opParts[0]);
      const parsedClose = parseTimeToMinutes(opParts[1]);
      if (parsedOpen !== -1 && parsedClose !== -1) {
        openMinutes = parsedOpen;
        closeMinutes = parsedClose;
      }
    }

    // 4. Batch-Load All Day Conflicts (Zero N+1 Queries)
    // A. Active Bookings for this resource (only timestamps, strictly zero private info)
    const activeBookings = await prisma.booking.findMany({
      where: {
        resourceId: resource.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        startTime: { lt: dayEndUtc },
        endTime: { gt: dayStartUtc },
      },
      select: {
        startTime: true,
        endTime: true,
      },
    });

    // B. Timetable Classes for this resource on this day of week
    const timetableClasses = await prisma.timetableEntry.findMany({
      where: {
        resourceId: resource.id,
        dayOfWeek: dayOfWeekKolkata,
      },
      select: {
        startTime: true, // "HH:mm"
        endTime: true,   // "HH:mm"
      },
    });

    // Convert timetable class times to minutes from midnight
    const classIntervals = timetableClasses
      .map((c) => ({
        startMin: parseTimeToMinutes(c.startTime),
        endMin: parseTimeToMinutes(c.endTime),
      }))
      .filter((c) => c.startMin !== -1 && c.endMin !== -1);

    // C. Department Blackout Periods
    const departmentPolicy = await prisma.departmentPolicy.findUnique({
      where: { department: resource.department },
      select: { blackoutPeriods: true },
    });

    const blackoutIntervals: Array<{ start: Date; end: Date }> = [];
    if (departmentPolicy?.blackoutPeriods) {
      try {
        const parsed = JSON.parse(departmentPolicy.blackoutPeriods) as Array<{
          start: string;
          end: string;
        }>;
        for (const b of parsed) {
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);
          if (bStart < dayEndUtc && bEnd > dayStartUtc) {
            blackoutIntervals.push({ start: bStart, end: bEnd });
          }
        }
      } catch {
        // Ignore JSON parse errors in malformed policies
      }
    }

    // 5. Generate 48 30-Minute Slots from 00:00 to 24:00
    const slotDurationMinutes = 30;
    const totalSlots = (24 * 60) / slotDurationMinutes;
    const slots: AvailabilitySlot[] = [];

    for (let i = 0; i < totalSlots; i++) {
      const slotStartMin = i * slotDurationMinutes;
      const slotEndMin = slotStartMin + slotDurationMinutes;

      const startTimeStr = formatMinutesToTimeString(slotStartMin);
      const endTimeStr = formatMinutesToTimeString(slotEndMin);

      const slotStartUtc = kolkataToUtc(dateParam, startTimeStr);
      const slotEndUtc =
        slotEndMin === 24 * 60
          ? dayEndUtc
          : kolkataToUtc(dateParam, endTimeStr);

      const detectedConflicts: AvailabilitySlotStatus[] = [];

      // Reason A: Outside Operating Hours
      const isOutsideHours =
        slotStartMin < openMinutes || slotEndMin > closeMinutes;
      if (isOutsideHours) {
        detectedConflicts.push('outside_hours');
      }

      // Reason B: Maintenance
      if (resource.isUnderMaintenance) {
        detectedConflicts.push('maintenance');
      }

      // Reason C: Blackout Period
      const isBlackout = blackoutIntervals.some(
        (b) => slotStartUtc < b.end && slotEndUtc > b.start
      );
      if (isBlackout) {
        detectedConflicts.push('blackout');
      }

      // Reason D: Scheduled Academic Class
      const isClass = classIntervals.some(
        (c) => slotStartMin < c.endMin && slotEndMin > c.startMin
      );
      if (isClass) {
        detectedConflicts.push('class');
      }

      // Reason E: Active Booking
      const isBooked = activeBookings.some(
        (b) => slotStartUtc < b.endTime && slotEndUtc > b.startTime
      );
      if (isBooked) {
        detectedConflicts.push('booked');
      }

      // 6. Determine Deterministic Primary Status and Human-Readable Reason
      // Priority: outside_hours > maintenance > blackout > class > booked > available
      let primaryStatus: AvailabilitySlotStatus = 'available';
      let primaryReason = 'Available for booking';

      if (detectedConflicts.includes('outside_hours')) {
        primaryStatus = 'outside_hours';
        primaryReason = 'Outside resource operating hours';
      } else if (detectedConflicts.includes('maintenance')) {
        primaryStatus = 'maintenance';
        primaryReason =
          resource.maintenanceReason || 'Resource is under maintenance';
      } else if (detectedConflicts.includes('blackout')) {
        primaryStatus = 'blackout';
        primaryReason = 'Unavailable due to a blackout period';
      } else if (detectedConflicts.includes('class')) {
        primaryStatus = 'class';
        primaryReason = 'Unavailable due to a scheduled class';
      } else if (detectedConflicts.includes('booked')) {
        primaryStatus = 'booked';
        primaryReason = 'Resource is already booked';
      }

      slots.push({
        startTime: startTimeStr,
        endTime: endTimeStr,
        startUtc: slotStartUtc.toISOString(),
        endUtc: slotEndUtc.toISOString(),
        status: primaryStatus,
        reason: primaryReason,
        conflicts: detectedConflicts.length > 1 ? detectedConflicts : undefined,
      });
    }

    const response: ResourceAvailabilityResponse = {
      resourceId: resource.id,
      resourceName: resource.name,
      date: dateParam,
      timezone: 'Asia/Kolkata',
      slotDurationMinutes,
      operatingHours: opHours,
      slots,
    };

    return ok(response);
  }
);
