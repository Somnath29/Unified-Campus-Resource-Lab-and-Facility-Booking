import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { ok, fail, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    const user = await requireAuth(request);
    const { id } = params;

    const session = await prisma.userSession.findUnique({
      where: { id },
      select: { id: true, userId: true, revokedAt: true, deviceLabel: true },
    });

    if (!session) {
      return fail(404, 'Session not found.');
    }

    if (session.userId !== user.id) {
      return fail(403, 'Forbidden: You cannot revoke another user\'s session.');
    }

    const now = new Date();
    if (!session.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.userSession.update({
          where: { id: session.id },
          data: { revokedAt: now },
        });

        await tx.auditLog.create({
          data: {
            action: 'SESSION_REVOKED',
            userId: user.id,
            entityType: 'UserSession',
            entityId: session.id,
            details: JSON.stringify({
              deviceLabel: session.deviceLabel,
              revokedAt: now.toISOString(),
            }),
          },
        });
      });
    }

    if (user.sessionId === session.id) {
      try {
        cookies().delete('token');
        cookies().delete('lpu_session');
      } catch {}
    }

    return ok({
      success: true,
      revokedSessionId: session.id,
      message: 'Session revoked successfully.',
    });
  }
);
