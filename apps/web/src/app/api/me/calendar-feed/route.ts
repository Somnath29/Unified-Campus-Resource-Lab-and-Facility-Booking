import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);

  const feed = await prisma.calendarFeed.findFirst({
    where: {
      userId: user.id,
      revokedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return ok({
    hasActiveFeed: Boolean(feed),
    createdAt: feed?.createdAt ? feed.createdAt.toISOString() : null,
    lastUsedAt: feed?.lastUsedAt ? feed.lastUsedAt.toISOString() : null,
  });
});

export const DELETE = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const now = new Date();

  await prisma.calendarFeed.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: now },
  });

  await prisma.auditLog.create({
    data: {
      action: 'CALENDAR_FEED_REVOKED',
      userId: user.id,
      entityType: 'CalendarFeed',
      entityId: user.id,
      details: JSON.stringify({ revokedAt: now.toISOString() }),
    },
  });

  return ok({
    success: true,
    message: 'Calendar subscription feed revoked. Existing feed URLs are now invalid.',
  });
});
