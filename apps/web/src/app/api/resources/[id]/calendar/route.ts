import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { getSessionUser } from '@/lib/auth';
import { BookingStatus } from '@prisma/client';
import {
  isValidDateString,
  getKolkataDayStartUtc,
  getKolkataDayEndUtc,
  getDayOfWeekInKolkata,
  getDateStringInKolkata,
  getTimeStringInKolkata,
  kolkataToUtc,
} from '@/lib/timezone';
import {
  CalendarEvent,
  BookingCalendarEvent,
  TimetableCalendarEvent,
  ResourceCalendarResponse,
} from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CALENDAR_DAYS = 90;

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const { id } = params;
    const { searchParams } = new URL(request.url);

    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // 1. Parameter Validation
    if (!from || !to) {
      return fail(
        400,
        "Both 'from' and 'to' query parameters (YYYY-MM-DD) are required."
      );
    }

    if (!isValidDateString(from) || !isValidDateString(to)) {
      return fail(
        400,
        "Invalid date format for 'from' or 'to'. Expected valid YYYY-MM-DD calendar dates."
      );
    }

    if (from > to) {
      return fail(400, "'from' date must be before or equal to 'to' date.");
    }

    // 2. Maximum Date Range Enforcement (Max 90 days)
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();
    const daysDiff = Math.round((toTime - fromTime) / (1000 * 60 * 60 * 24)) + 1;

    if (daysDiff > MAX_CALENDAR_DAYS) {
      return fail(
        400,
        `Date range exceeds maximum allowed limit of ${MAX_CALENDAR_DAYS} days (requested: ${daysDiff} days).`
      );
    }

    // 3. Resource Verification
    const resource = await prisma.resource.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        deletedAt: true,
      },
    });

    if (!resource || resource.deletedAt !== null) {
      return fail(404, 'Resource not found or has been archived.');
    }

    // 4. Authenticated Requester Context (if present)
    const currentUser = await getSessionUser(request);
    const currentUserId = currentUser?.id ?? null;

    // 5. Calculate UTC Range Boundaries for Asia/Kolkata
    const rangeStartUtc = getKolkataDayStartUtc(from);
    const rangeEndUtc = getKolkataDayEndUtc(to);

    // 6. Fetch Active Bookings Overlapping Range (Single Bounded Query)
    const bookings = await prisma.booking.findMany({
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
        startTime: { lt: rangeEndUtc },
        endTime: { gt: rangeStartUtc },
      },
      select: {
        id: true,
        userId: true,
        startTime: true,
        endTime: true,
        purpose: true,
        activityType: true,
        status: true,
      },
      orderBy: { startTime: 'asc' },
    });

    // 7. Transform Bookings with Strict Backend-Enforced Privacy
    const bookingEvents: BookingCalendarEvent[] = bookings.map((b) => {
      const isOwner = currentUserId !== null && b.userId === currentUserId;

      const startKolkata = `${getDateStringInKolkata(b.startTime)} ${getTimeStringInKolkata(b.startTime)}`;
      const endKolkata = `${getDateStringInKolkata(b.endTime)} ${getTimeStringInKolkata(b.endTime)}`;

      if (isOwner) {
        return {
          id: b.id,
          type: 'BOOKING',
          start: startKolkata,
          end: endKolkata,
          startUtc: b.startTime.toISOString(),
          endUtc: b.endTime.toISOString(),
          title: b.purpose || 'My Booking',
          isOwner: true,
          status: b.status,
          purpose: b.purpose,
          activityType: b.activityType,
        };
      }

      // STRICT PRIVACY: For any other user, return strictly generic 'Booked'
      // NEVER leak purpose, activityType, user ID, email, or any personal details!
      return {
        id: b.id,
        type: 'BOOKING',
        start: startKolkata,
        end: endKolkata,
        startUtc: b.startTime.toISOString(),
        endUtc: b.endTime.toISOString(),
        title: 'Booked',
        isOwner: false,
        status: b.status,
      };
    });

    // 8. Fetch and Expand Timetable Entries (Single Bounded Query)
    const timetableEntries = await prisma.timetableEntry.findMany({
      where: { resourceId: resource.id },
      select: {
        id: true,
        courseCode: true,
        courseName: true,
        instructorName: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
      },
    });

    const timetableEvents: TimetableCalendarEvent[] = [];

    if (timetableEntries.length > 0) {
      // Loop over each day in the requested [from, to] range
      const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
      const curr = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));

      for (let d = 0; d < daysDiff; d++) {
        const dayStr = curr.toISOString().split('T')[0];
        const dayStartUtc = getKolkataDayStartUtc(dayStr);
        const dayOfWeek = getDayOfWeekInKolkata(dayStartUtc);

        const matchingClasses = timetableEntries.filter(
          (t) => t.dayOfWeek === dayOfWeek
        );

        for (const cls of matchingClasses) {
          const clsStartUtc = kolkataToUtc(dayStr, cls.startTime);
          const clsEndUtc = kolkataToUtc(dayStr, cls.endTime);

          if (clsStartUtc < rangeEndUtc && clsEndUtc > rangeStartUtc) {
            timetableEvents.push({
              id: `${cls.id}-${dayStr}`,
              type: 'CLASS',
              start: `${dayStr} ${cls.startTime}`,
              end: `${dayStr} ${cls.endTime}`,
              startUtc: clsStartUtc.toISOString(),
              endUtc: clsEndUtc.toISOString(),
              title: cls.courseName || cls.courseCode || 'Class',
              courseCode: cls.courseCode,
              instructorName: cls.instructorName,
              isOwner: false,
            });
          }
        }

        curr.setUTCDate(curr.getUTCDate() + 1);
      }
    }

    // 9. Combine and Sort Chronologically
    const allEvents: CalendarEvent[] = [
      ...bookingEvents,
      ...timetableEvents,
    ].sort((a, b) => new Date(a.startUtc).getTime() - new Date(b.startUtc).getTime());

    const response: ResourceCalendarResponse = {
      resourceId: resource.id,
      resourceName: resource.name,
      from,
      to,
      timezone: 'Asia/Kolkata',
      events: allEvents,
    };

    return ok(response);
  }
);
