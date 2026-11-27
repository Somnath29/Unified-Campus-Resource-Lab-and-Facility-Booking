import { ok, fail, withErrorHandling } from '@/lib/api-response';
import env from '@/config/env';
import { WaitlistService } from '@/services/waitlistService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyJobAuthorization(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const headerSecret = request.headers.get('x-cron-secret');

  const providedSecret = token || headerSecret;
  return Boolean(providedSecret && providedSecret === env.CRON_SECRET);
}

export const POST = withErrorHandling(async (request: Request) => {
  if (!verifyJobAuthorization(request)) {
    return fail(401, 'Unauthorized: Invalid or missing CRON_SECRET authorization token.');
  }

  const result = await WaitlistService.processOfferExpiry();
  return ok(result);
});

export const GET = withErrorHandling(async (request: Request) => {
  if (!verifyJobAuthorization(request)) {
    return fail(401, 'Unauthorized: Invalid or missing CRON_SECRET authorization token.');
  }

  const result = await WaitlistService.processOfferExpiry();
  return ok(result);
});
