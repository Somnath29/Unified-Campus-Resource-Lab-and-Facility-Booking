import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';
import { SeriesBookingService } from '@/services/seriesBookingService';
import { prisma } from '@/lib/prisma';
import { OccurrenceCancellationScope } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { reason, scope } = body;

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return fail(400, 'A non-empty cancellation reason is required.');
    }

    // If cancellation scope is specified (e.g. THIS_AND_FOLLOWING, ENTIRE_SERIES), handle series cancellation
    if (scope && scope !== 'ONE') {
      const booking = await prisma.booking.findUnique({
        where: { id },
        select: { id: true, seriesId: true },
      });

      if (booking?.seriesId) {
        const seriesResult = await SeriesBookingService.cancelSeriesBookings({
          user,
          seriesId: booking.seriesId,
          scope: scope as OccurrenceCancellationScope,
          targetBookingId: id,
          reason,
        });

        return ok({
          seriesCancellation: seriesResult,
          message: seriesResult.message,
        });
      }
    }

    const updated = await BookingService.cancelBooking(id, user, reason);
    const eligibility = BookingService.computeBookingEligibility(updated, user);

    return ok({
      booking: {
        ...updated,
        startTime: updated.startTime.toISOString(),
        endTime: updated.endTime.toISOString(),
        actualEndTime: updated.actualEndTime ? updated.actualEndTime.toISOString() : null,
        checkedInAt: updated.checkedInAt ? updated.checkedInAt.toISOString() : null,
        releaseDeadline: updated.releaseDeadline ? updated.releaseDeadline.toISOString() : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        eligibility,
      },
      cancellationReason: updated.rejectionReason || reason,
      cancelledAt: new Date().toISOString(),
      message: 'Booking cancelled successfully.',
    });
  }
);
