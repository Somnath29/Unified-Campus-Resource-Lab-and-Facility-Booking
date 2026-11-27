import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const booking = await BookingService.getBookingById(id, user);
    return ok({ booking });
  }
);

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const result = await BookingService.rescheduleBooking({
      id,
      user,
      input: body,
    });
    return ok(result);
  }
);
