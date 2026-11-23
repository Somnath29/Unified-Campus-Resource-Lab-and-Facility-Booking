import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingStatus, Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const { token, bookingId } = body;

  if (!token && !bookingId) {
    return fail(400, 'Please provide a valid QR check-in token or booking ID.');
  }

  const where: Prisma.BookingWhereInput = {};
  if (token) where.checkInToken = String(token).trim();
  if (bookingId) where.id = String(bookingId);

  const booking = await prisma.booking.findFirst({
    where,
    include: { resource: true, user: true },
  });

  if (!booking) {
    return fail(404, 'No matching reservation found for this verification code.');
  }

  if (booking.status === BookingStatus.CHECKED_IN) {
    return ok({
      message: 'This reservation is already checked-in.',
      booking,
    });
  }

  if (booking.status === BookingStatus.NO_SHOW) {
    return fail(
      400,
      'This reservation has been marked as NO-SHOW and released due to elapsed check-in window.'
    );
  }

  if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.REJECTED) {
    return fail(400, `Cannot check in to a booking with status ${booking.status}.`);
  }

  const now = new Date();
  const earliestCheckIn = new Date(booking.startTime.getTime() - 30 * 60000);

  if (now < earliestCheckIn) {
    return fail(
      400,
      `Check-in opens 30 minutes prior to reservation start time (${booking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`
    );
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: BookingStatus.CHECKED_IN,
      checkedInAt: now,
    },
    include: { resource: true, user: true },
  });

  // Notify user
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: `Check-in Verified: ${booking.resource.name}`,
      message: `Welcome! Your check-in for ${booking.resource.name} is confirmed at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      type: 'CHECKIN',
      link: '/my-bookings',
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      action: 'CHECKIN_COMPLETED',
      userId: user.id,
      entityType: 'Booking',
      entityId: booking.id,
      details: `Verified check-in for ${booking.resource.name} via ${token ? 'Token' : 'Direct'} verification`,
    },
  });

  return ok({
    success: true,
    message: `Check-in successful! Resource ${booking.resource.name} is active for your session.`,
    booking: updated,
  });
});
