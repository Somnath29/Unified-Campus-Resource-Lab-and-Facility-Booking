import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingStatus, Role } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { reason } = body;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!booking) {
      return fail(404, 'Booking not found.');
    }

    if (user.role === Role.STUDENT && booking.userId !== user.id) {
      return fail(403, 'Unauthorized to cancel this booking.');
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        rejectionReason: reason || 'Cancelled by requester',
      },
    });

    // Notify user
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: `Booking Cancelled: ${booking.resource.name}`,
        message: `Booking #${booking.bookingNumber} was successfully cancelled.`,
        type: 'BOOKING',
      },
    });

    return ok({
      booking: updated,
      message: 'Booking cancelled successfully.',
    });
  }
);
