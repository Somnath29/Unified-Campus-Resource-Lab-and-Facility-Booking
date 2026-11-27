import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { CheckInService } from '@/services/checkInService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    if (!id) {
      return fail(400, 'Booking ID is required.');
    }

    const tokenData = await CheckInService.generateBookingCheckInToken({
      bookingId: id,
      actor: user,
    });

    return ok(tokenData);
  }
);
