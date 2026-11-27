import { prisma } from '@/lib/prisma';
import { withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingStatus } from '@prisma/client';
import { generateUserCalendarIcs } from '@/lib/ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exports the authenticated user's eligible bookings (CONFIRMED, CHECKED_IN, PENDING, COMPLETED).
 * Cancelled, rejected, and no-show bookings are excluded from the personal schedule export.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);

  const bookings = await prisma.booking.findMany({
    where: {
      userId: user.id,
      status: {
        in: [
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.PENDING,
          BookingStatus.COMPLETED,
        ],
      },
    },
    include: {
      resource: {
        select: { name: true, building: true, floor: true },
      },
    },
    orderBy: { startTime: 'asc' },
    take: 500,
  });

  const icsContent = generateUserCalendarIcs(bookings, `LPU Bookings (${user.name})`);

  return new Response(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="lpu-my-bookings.ics"',
      'Cache-Control': 'private, no-store, no-cache, must-revalidate',
    },
  });
});
