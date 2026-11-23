import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);

  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });

  return ok({ success: true, message: 'All notifications marked as read.' });
});
