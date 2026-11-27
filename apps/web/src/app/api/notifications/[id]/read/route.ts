import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function markNotificationReadHandler(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await requireAuth(request);
  const { id } = params;

  const existing = await prisma.notification.findUnique({
    where: { id },
    select: { id: true, userId: true, read: true, readAt: true },
  });

  if (!existing) {
    return fail(404, 'Notification not found.');
  }

  if (existing.userId !== user.id) {
    return fail(403, 'Forbidden: You cannot modify another user\'s notification.');
  }

  const readAt = existing.readAt || new Date();
  const updated = existing.read
    ? existing
    : await prisma.notification.update({
        where: { id },
        data: { read: true, readAt },
      });

  return ok({
    success: true,
    notification: {
      ...updated,
      readAt: updated.readAt ? updated.readAt.toISOString() : readAt.toISOString(),
    },
  });
}

export const PATCH = withErrorHandling(markNotificationReadHandler);
export const PUT = withErrorHandling(markNotificationReadHandler);
