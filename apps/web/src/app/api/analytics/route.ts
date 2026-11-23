import { ok, withErrorHandling } from '@/lib/api-response';
import { requireRole } from '@/lib/auth';
import { Role } from '@prisma/client';
import { getAnalyticsData } from '@/server/services/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  await requireRole(request, Role.ADMINISTRATOR, Role.DEPARTMENT_APPROVER);
  const data = await getAnalyticsData();
  return ok(data);
});
