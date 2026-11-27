import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    await tx.auditLog.create({
      data: {
        action: 'ALL_SESSIONS_REVOKED',
        userId: user.id,
        entityType: 'User',
        entityId: user.id,
        details: JSON.stringify({
          revokedAt: now.toISOString(),
        }),
      },
    });
  });

  try {
    cookies().delete('token');
    cookies().delete('lpu_session');
  } catch {}

  return ok({
    success: true,
    message: 'All active sessions have been signed out across all devices.',
  });
});
