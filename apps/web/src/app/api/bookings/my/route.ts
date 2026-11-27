import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { BookingService } from '@/services/bookingService';
import { MyBookingsTab } from '@lpu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const { searchParams } = new URL(request.url);

  const rawTab = searchParams.get('tab')?.toUpperCase();
  const validTabs: MyBookingsTab[] = ['UPCOMING', 'PENDING', 'PAST', 'CANCELLED'];
  const tab: MyBookingsTab = validTabs.includes(rawTab as MyBookingsTab)
    ? (rawTab as MyBookingsTab)
    : 'UPCOMING';

  const page = parseInt(searchParams.get('page') || '1', 10) || 1;
  const limit = parseInt(searchParams.get('limit') || '10', 10) || 10;
  const sortBy = (searchParams.get('sortBy') as any) || 'startTime';
  const sortOrder = (searchParams.get('sortOrder') as any) || 'asc';

  const result = await BookingService.getMyBookings(user, {
    tab,
    page,
    limit,
    sortBy,
    sortOrder,
  });

  return ok(result);
});
