import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);

  const sessions = await prisma.userSession.findMany({
    where: {
      userId: user.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: 'desc' },
    select: {
      id: true,
      deviceLabel: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastActiveAt: true,
      expiresAt: true,
    },
  });

  return ok({
    sessions: sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel || 'Unknown device',
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      isCurrent: Boolean(user.sessionId && user.sessionId === s.id),
    })),
  });
});
