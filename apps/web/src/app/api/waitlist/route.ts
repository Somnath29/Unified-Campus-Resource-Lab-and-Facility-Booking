import { ok, created, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import { WaitlistService } from '@/services/waitlistService';
import { WaitlistStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const body = await request.json().catch(() => ({}));
  const { resourceId, startTime, endTime } = body;

  if (!resourceId || typeof resourceId !== 'string') {
    return fail(400, 'resourceId is required.');
  }

  if (!startTime || typeof startTime !== 'string') {
    return fail(400, 'startTime is required.');
  }

  if (!endTime || typeof endTime !== 'string') {
    return fail(400, 'endTime is required.');
  }

  const result = await WaitlistService.joinWaitlist({
    user,
    input: {
      resourceId,
      startTime,
      endTime,
    },
  });

  return created(result);
});

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const { searchParams } = new URL(request.url);

  const statusParam = searchParams.get('status')?.toUpperCase();
  const validStatuses: WaitlistStatus[] = [
    WaitlistStatus.WAITING,
    WaitlistStatus.OFFERED,
    WaitlistStatus.EXPIRED,
    WaitlistStatus.FULFILLED,
    WaitlistStatus.WITHDRAWN,
  ];

  const status = validStatuses.includes(statusParam as WaitlistStatus)
    ? (statusParam as WaitlistStatus)
    : undefined;

  const page = parseInt(searchParams.get('page') || '1', 10) || 1;
  const limit = parseInt(searchParams.get('limit') || '10', 10) || 10;

  const result = await WaitlistService.getUserWaitlist({
    user,
    query: {
      status: status as any,
      page,
      limit,
    },
  });

  return ok(result);
});
