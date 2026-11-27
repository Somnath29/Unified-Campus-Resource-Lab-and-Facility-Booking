import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function markAllReadHandler(request: Request) {
  const user = await requireAuth(request);
  const now = new Date();

  const res = await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true, readAt: now },
  });

  return ok({
    success: true,
    updatedCount: res.count,
    message: 'All notifications marked as read.',
  });
}

export const PATCH = withErrorHandling(markAllReadHandler);
export const PUT = withErrorHandling(markAllReadHandler);
