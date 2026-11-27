import { ok, fail, withErrorHandling } from '@/lib/api-response';
import env from '@/config/env';
import { ReminderService } from '@/services/reminderService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleProcessReminders(request: Request) {
  const authHeader = request.headers.get('authorization');
  const expectedSecret = env.CRON_SECRET;

  if (!authHeader || authHeader !== `Bearer ${expectedSecret}`) {
    return fail(401, 'Unauthorized: Invalid or missing CRON_SECRET.');
  }

  const result = await ReminderService.runAll();
  return ok(result);
}

export const GET = withErrorHandling(handleProcessReminders);
export const POST = withErrorHandling(handleProcessReminders);
