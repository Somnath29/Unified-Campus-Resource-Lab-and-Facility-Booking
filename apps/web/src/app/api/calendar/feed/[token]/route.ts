import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { fail, withErrorHandling } from '@/lib/api-response';
import { BookingStatus } from '@prisma/client';
import { generateUserCalendarIcs } from '@/lib/ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (_request: Request, { params }: { params: { token: string } }) => {
    const rawParam = params.token || '';
    const token = rawParam.endsWith('.ics') ? rawParam.slice(0, -4) : rawParam;

    if (!token || token.length < 32) {
      return fail(401, 'Invalid or revoked calendar feed URL.');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const feed = await prisma.calendarFeed.findUnique({
      where: { tokenHash },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    if (!feed || feed.revokedAt !== null) {
      return fail(401, 'Invalid or revoked calendar feed URL.');
    }

    // Update lastUsedAt non-blockingly
    prisma.calendarFeed
      .update({
        where: { id: feed.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    const bookings = await prisma.booking.findMany({
      where: {
        userId: feed.userId,
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

    const icsContent = generateUserCalendarIcs(bookings, `LPU Bookings (${feed.user.name})`);

    return new Response(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="lpu-calendar-feed.ics"',
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    });
  }
);
