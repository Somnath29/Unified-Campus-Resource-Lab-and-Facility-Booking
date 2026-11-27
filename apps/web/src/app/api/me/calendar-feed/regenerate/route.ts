import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ok, withErrorHandling } from '@/lib/api-response';
import { requireAuth } from '@/lib/auth';
import env from '@/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request: Request) => {
  const user = await requireAuth(request);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const now = new Date();

  const feed = await prisma.$transaction(async (tx) => {
    await tx.calendarFeed.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    const created = await tx.calendarFeed.create({
      data: {
        userId: user.id,
        tokenHash,
      },
    });

    await tx.auditLog.create({
      data: {
        action: 'CALENDAR_FEED_REGENERATED',
        userId: user.id,
        entityType: 'CalendarFeed',
        entityId: created.id,
        details: JSON.stringify({ createdAt: now.toISOString() }),
      },
    });

    return created;
  });

  const baseUrl = env.APP_URL.replace(/\/+$/, '');
  const feedUrl = `${baseUrl}/api/calendar/feed/${rawToken}.ics`;

  return ok({
    feedUrl,
    createdAt: feed.createdAt.toISOString(),
    message: 'New calendar subscription URL generated. Any previous URL is now invalid.',
  });
});
