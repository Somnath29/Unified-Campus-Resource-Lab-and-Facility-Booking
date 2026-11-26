import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { reason } = body;

    const updated = await BookingService.cancelBooking(id, user, reason);

    return ok({
      booking: updated,
      message: 'Booking cancelled successfully.',
    });
  }
);
