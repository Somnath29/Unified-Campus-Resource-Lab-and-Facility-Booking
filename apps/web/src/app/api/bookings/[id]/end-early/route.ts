import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    const result = await BookingService.endBookingEarly(id, user);

    return ok(result);
  }
);
