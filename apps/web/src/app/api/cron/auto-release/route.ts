import { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { processAutoRelease } from '@/server/services/autoRelease';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  if (!token || token !== env.CRON_SECRET) {
    return fail(401, 'Unauthorized: Invalid or missing CRON_SECRET authorization token.');
  }

  const result = await processAutoRelease();
  return ok(result);
});
