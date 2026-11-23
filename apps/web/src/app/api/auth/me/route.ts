import { requireAuth } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  return ok({ user });
});
