import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/api-response';
import { getAuthoritativeQuota } from '@/services/policyService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/me/quota
 * Returns authoritative weekly quota usage, limits, and policy information
 * for the authenticated requester in Asia/Kolkata timezone.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date') || undefined;

  const quota = await getAuthoritativeQuota({
    user,
    date: dateParam,
    prisma,
  });

  return ok(quota);
});
