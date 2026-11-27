import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    const existing = await prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!existing) {
      return fail(404, 'Notification not found.');
    }

    if (existing.userId !== user.id) {
      return fail(403, 'Forbidden: You cannot delete another user\'s notification.');
    }

    await prisma.notification.delete({
      where: { id },
    });

    return ok({ success: true, message: 'Notification deleted.' });
  }
);
