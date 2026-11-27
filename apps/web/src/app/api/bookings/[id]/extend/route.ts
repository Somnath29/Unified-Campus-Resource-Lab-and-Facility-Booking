import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;
    const body = await request.json().catch(() => ({}));
    const { durationMinutes } = body;

    if (!durationMinutes || typeof durationMinutes !== 'number' || durationMinutes <= 0) {
      return fail(400, 'A positive durationMinutes number is required for booking extension.');
    }

    const result = await BookingService.extendBooking(id, user, durationMinutes);

    return ok(result);
  }
);
