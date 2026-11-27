import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { SeriesBookingService } from '@/services/seriesBookingService';
import { OccurrenceCancellationScope } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const seriesId = params.id;
    const body = await request.json().catch(() => ({}));
    const { scope = 'ENTIRE_SERIES', targetBookingId, reason } = body;

    const result = await SeriesBookingService.cancelSeriesBookings({
      user,
      seriesId,
      scope: scope as OccurrenceCancellationScope,
      targetBookingId,
      reason,
    });

    return ok(result);
  }
);
